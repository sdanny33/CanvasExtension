chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchExternalDueDates') {
    fetch(request.url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const text = await res.text();
        sendResponse({ success: true, html: text });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }
});