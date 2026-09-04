let appState = {
  plannerItems: [],
  courseMap: {}
};

const FALLBACK_PALETTE = ['#8a2be2', '#dc2626', '#16a34a', '#2563eb', '#d97706', '#db2777'];

// Helper to calculate a 14-day rolling window: 7 days prior to 7 days ahead
function getDateWindow() {
  const now = new Date();
  
  // 7 days before today (00:00:00)
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
  
  // 7 days after today (23:59:59)
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59);

  return {
    startDate,
    endDate,
    startIso: startDate.toISOString().split('T')[0],
    endIso: endDate.toISOString().split('T')[0]
  };
}

// Scrape live computed colors directly from the dashboard course cards
function getDashboardDomColors() {
  const domColors = {};
  const cards = document.querySelectorAll('.ic-DashboardCard');
  cards.forEach(card => {
    const courseLink = card.querySelector('a.ic-DashboardCard__link');
    const header = card.querySelector('.ic-DashboardCard__header_hero');
    if (!courseLink || !header) return;

    const href = courseLink.getAttribute('href') || '';
    const match = href.match(/\/courses\/(\d+)/);
    if (!match) return;

    const courseId = Number(match[1]);
    const computedBg = window.getComputedStyle(header).backgroundColor;
    if (computedBg && computedBg !== 'rgba(0, 0, 0, 0)') {
      domColors[courseId] = computedBg;
    }
  });
  return domColors;
}

// Fetch external course assignments from CS 3214 page via background script
async function fetchCS3214Tasks() {
  const targetUrl = 'https://courses.cs.vt.edu/cs3214/fall2026/exercises/duedates';

  return new Promise((resolve) => {
    if (!chrome.runtime?.sendMessage) {
      return resolve([]);
    }

    chrome.runtime.sendMessage(
      { action: 'fetchExternalDueDates', url: targetUrl },
      (response) => {
        if (!response || !response.success) {
          console.warn('Could not load external due dates:', response?.error);
          return resolve([]);
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(response.html, 'text/html');
        const tasks = [];

        const rows = doc.querySelectorAll('tbody tr');
        rows.forEach((row, index) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            const exerciseId = cells[0].textContent.trim(); // e.g., "ex0"
            const exerciseTitle = cells[1].textContent.trim(); // e.g., "Exercise 0 Warmup"
            
            // Clone cell to strip out child elements (links/buttons/icons) before parsing date
            const dateCellClone = cells[2].cloneNode(true);
            dateCellClone.querySelectorAll('a, button, svg').forEach(el => el.remove());
            
            // Clean out relative date text like "(in 5 days)"
            const rawDateText = dateCellClone.textContent.trim();
            const cleanDateText = rawDateText.split('(')[0].trim();
            const parsedDate = new Date(cleanDateText);

            if (!isNaN(parsedDate.getTime())) {
              tasks.push({
                plannable_id: `cs3214_${exerciseId || index}`,
                course_id: 'cs3214_custom',
                context_name: 'Computer Systems',
                plannable: {
                  title: `${exerciseId}: ${exerciseTitle}`
                },
                plannable_date: parsedDate.toISOString(),
                html_url: targetUrl
              });
            }
          }
        });

        resolve(tasks);
      }
    );
  });
}

// Pull planner data, courses, colors, nicknames, and external exercises
async function fetchPlannerData() {
  const { startIso, endIso, startDate, endDate } = getDateWindow();

// Inside fetchPlannerData():
  const [plannerRes, coursesRes, colorsRes, nicknamesRes, csTasks] = await Promise.all([
    fetch(`/api/v1/planner/items?start_date=${encodeURIComponent(startIso)}&end_date=${encodeURIComponent(endIso)}&per_page=100`),
    fetch('/api/v1/courses?enrollment_state=active&per_page=50'),
    fetch('/api/v1/users/self/colors'),
    fetch('/api/v1/users/self/course_nicknames'),
    fetchCS3214Tasks()
  ]);

  const [plannerItems, courses, colorsData, nicknames] = await Promise.all([
    plannerRes.ok ? plannerRes.json() : [],
    coursesRes.ok ? coursesRes.json() : [],
    colorsRes.ok ? colorsRes.json() : { custom_colors: {} },
    nicknamesRes.ok ? nicknamesRes.json() : []
  ]);

  const customColors = colorsData.custom_colors || {};
  const domColors = getDashboardDomColors();

  const nicknameMap = {};
  nicknames.forEach(n => {
    nicknameMap[n.course_id] = n.nickname;
  });

  const courseMap = {};
  courses.forEach((c, index) => {
    const friendlyName = nicknameMap[c.id] || c.name || c.original_name || c.course_code || 'Course';
    const resolvedColor = domColors[c.id] || 
                          customColors[`course_${c.id}`] || 
                          FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];

    courseMap[c.id] = {
      name: friendlyName,
      color: resolvedColor
    };
  });

  // Assign color and label for external CS 3214 tasks
  courseMap['cs3214_custom'] = {
    name: 'Computer Systems',
    color: '#0d6efd'
  };

  // Filter all assignments strictly within the 7-day rolling window
  const combinedItems = [...plannerItems, ...csTasks]
    .filter(item => {
      if (!item.plannable_date) return false;
      const dueDate = new Date(item.plannable_date);
      return dueDate >= startDate && dueDate <= endDate;
    })
    .sort((a, b) => new Date(a.plannable_date) - new Date(b.plannable_date));

  return { plannerItems: combinedItems, courseMap };
}

function resolveCourseId(item) {
  return item.course_id || item.context_id || item.plannable?.course_id || null;
}

function getCompletedTaskIds() {
  return JSON.parse(localStorage.getItem('canvas_completed_tasks') || '[]');
}

function toggleTask(taskId) {
  let completed = getCompletedTaskIds();
  if (completed.includes(taskId)) {
    completed = completed.filter(id => id !== taskId);
  } else {
    completed.push(taskId);
  }
  localStorage.setItem('canvas_completed_tasks', JSON.stringify(completed));
  renderApp();
}

function renderCard(item, isDone) {
  const id = item.plannable_id;
  const courseId = resolveCourseId(item);
  const course = appState.courseMap[courseId] || { 
    name: item.context_name || 'General', 
    color: '#4b5563' 
  };
  
  const title = item.plannable?.title || item.plannable?.name || 'Assignment';
  const date = item.plannable_date
    ? new Date(item.plannable_date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    : 'No due date';

  return `
    <div class="task-card ${isDone ? 'is-completed' : ''}" data-task-id="${id}">
      <div class="task-info">
        <span class="task-course-name" style="color: ${course.color}">${course.name}</span>
        <a href="${item.html_url || '#'}" target="_blank" class="task-title" style="color: ${course.color}">${title}</a>
        <span class="task-due-date" style="color: ${course.color}">${date}</span>
      </div>
      <button class="task-checkbox ${isDone ? 'checked' : ''}" data-id="${id}" aria-label="Toggle completion"></button>
    </div>
  `;
}

function renderApp() {
  const completed = getCompletedTaskIds();
  const activeTasks = appState.plannerItems.filter(item => !completed.includes(item.plannable_id));
  const completedTasks = appState.plannerItems.filter(item => completed.includes(item.plannable_id));

  // 1. Render Progress Bars
  const stats = {};
  appState.plannerItems.forEach(task => {
    const cId = resolveCourseId(task) || 'general';
    if (!stats[cId]) {
      stats[cId] = {
        total: 0,
        done: 0,
        color: appState.courseMap[cId]?.color || '#4b5563'
      };
    }
    stats[cId].total += 1;
    if (completed.includes(task.plannable_id)) {
      stats[cId].done += 1;
    }
  });

  const barsHtml = Object.values(stats).map(data => {
    const percentage = data.total > 0 ? (data.done / data.total) * 100 : 0;
    return `
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width: ${percentage}%; background-color: ${data.color};"></div>
      </div>
    `;
  }).join('');

  const barsContainer = document.getElementById('task-progress-bars');
  if (barsContainer) barsContainer.innerHTML = barsHtml;

  // 2. Render Active Task Cards
  const activeContainer = document.getElementById('active-tasks-list');
  if (activeContainer) {
    activeContainer.innerHTML = activeTasks.length > 0
      ? activeTasks.map(item => renderCard(item, false)).join('')
      : `<p class="task-empty-msg">All caught up!</p>`;
  }

  // 3. Render Completed Task Cards
  const completedContainer = document.getElementById('completed-tasks-list');
  const completedCount = document.getElementById('completed-count');
  if (completedCount) completedCount.innerText = completedTasks.length;
  
  if (completedContainer) {
    completedContainer.innerHTML = completedTasks.length > 0
      ? completedTasks.map(item => renderCard(item, true)).join('')
      : `<p class="task-empty-msg">No completed tasks yet.</p>`;
  }
}

function replaceTodoList(targetElement) {
  if (document.getElementById('custom-task-container')) return;

  const root = document.createElement('div');
  root.id = 'custom-task-container';

  root.innerHTML = `
    <div class="progress-card">
      <div class="progress-header">Progress</div>
      <div id="task-progress-bars" class="progress-bars-container"></div>
    </div>
    
    <div id="active-tasks-list" class="task-cards-list"></div>

    <details class="completed-section">
      <summary class="completed-summary">Completed (<span id="completed-count">0</span>)</summary>
      <div id="completed-tasks-list" class="task-cards-list" style="margin-top: 10px;"></div>
    </details>
  `;

  targetElement.replaceWith(root);

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.task-checkbox');
    if (btn) {
      const rawId = btn.dataset.id;
      const parsedId = isNaN(Number(rawId)) ? rawId : Number(rawId);
      toggleTask(parsedId);
    }
  });

  renderApp();
}

function mountExtension(data) {
  appState = data;

  const selector = '[data-testid="ToDoSidebar"], .Sidebar__TodoListContainer';
  const existingElement = document.querySelector(selector);

  if (existingElement) {
    replaceTodoList(existingElement);
    return;
  }

  const observer = new MutationObserver((_, obs) => {
    const target = document.querySelector(selector);
    if (target) {
      obs.disconnect();
      replaceTodoList(target);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Initialize
fetchPlannerData()
  .then(mountExtension)
  .catch(console.error);