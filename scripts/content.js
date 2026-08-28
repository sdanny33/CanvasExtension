async function fetchTasks() {
  const today = new Date().toISOString().split('T')[0];
  const response = await fetch(`/api/v1/planner/items?start_date=${today}`);
  
  if (!response.ok) {
    throw new Error(`Canvas API error: ${response.status}`);
  }
  return await response.json();
}

function renderTaskPanel(tasks) {
  // Prevent duplicate injections if script runs multiple times
  if (document.getElementById('custom-task-panel')) return;

  const targetContainer = document.getElementById('right-side') || 
                          document.getElementById('content') || 
                          document.querySelector('.ic-Dashboard-header__layout');

  if (!targetContainer) {
    console.warn('Canvas task mount container not found.');
    return;
  }

  const panel = document.createElement('div');
  panel.id = 'custom-task-panel';
  panel.className = 'custom-task-card';

  if (!tasks || tasks.length === 0) {
    panel.innerHTML = `
      <div class="task-card-header">Upcoming Tasks</div>
      <p class="task-empty-msg">No upcoming tasks found!</p>
    `;
  } else {
    panel.innerHTML = `
      <div class="task-card-header">Upcoming Tasks (${tasks.length})</div>
      <ul class="task-card-list">
        ${tasks.map(item => {
          const title = item.plannable?.title || item.plannable?.name || 'Untitled Event';
          const dueDate = item.plannable_date 
            ? new Date(item.plannable_date).toLocaleDateString(undefined, { 
                month: 'short', 
                day: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit' 
              })
            : 'No date';
          const link = item.html_url || '#';

          return `
            <li class="task-card-item">
              <a href="${link}" class="task-title" target="_blank" rel="noopener noreferrer">${title}</a>
              <span class="task-date">${dueDate}</span>
            </li>
          `;
        }).join('')}
      </ul>
    `;
  }

  targetContainer.prepend(panel);
}

// Execute on page load
fetchTasks()
  .then(renderTaskPanel)
  .catch(err => console.error('Error rendering Canvas tasks:', err));