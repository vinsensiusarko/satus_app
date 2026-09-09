// Code.gs

function doGet(e) {
  // Check if incoming request is targeting the API (e.g. ?action=ping or ?action=login)
  if (e && ((e.parameter && (e.parameter.action || e.parameter.endpoint || e.parameter.api)) || (e.pathInfo && e.pathInfo.length > 0))) {
    return handleApiRequest(e, 'GET');
  }

  // Always default to login, frontend JS will handle routing based on session
  return HtmlService.createTemplateFromFile('frontend/index')
    .evaluate()
    .setTitle('SATUS - Kantong Hijau')
    .setFaviconUrl('https://iili.io/nFG1IAQ.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  return handleApiRequest(e, 'POST');
}

// Function to include HTML parts
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
