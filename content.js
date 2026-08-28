async function fetchTasks() {
  const today = new Date().toISOString().split('T')[0];
  const response = await fetch(`/api/v1/planner/items?start_date=${today}`);
  if (!response.ok) throw new Error('Failed to load Canvas planner');
  return await response.json();
}

function renderTaskPanel(tasks) {
  // Target Canvas's right sidebar or main dashboard container
  const targetContainer = document.getElementById('right-side') || document.getElementById('content');
  if (!targetContainer) return;

  const panel = document.createElement('div');
  panel.className = 'custom-task-card';
  panel.innerHTML = `
    <h3>Upcoming Tasks</h3>
    <ul>
      ${tasks.map(t => `
        <li>
          <strong>${t.plannable.title}</strong>
          <span>Due: ${new Date(t.plannable_date).toLocaleDateString()}</span>
        </li>
      `).join('')}
    </ul>
  `;

  targetContainer.prepend(panel);
}

// Initialize on page load
fetchTasks()
  .then(renderTaskPanel)
  .catch(console.error);