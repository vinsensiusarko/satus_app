// Code.gs

function doGet(e) {
  // Always default to login, frontend JS will handle routing based on session
  return HtmlService.createTemplateFromFile('frontend/index')
    .evaluate()
    .setTitle('SATUS - Kantong Hijau')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Function to include HTML parts
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
