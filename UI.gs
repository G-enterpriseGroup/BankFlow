// Run automatically when the spreadsheet is opened
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Bank Flow by - Raj')
    .addItem('Open Bank Connector', 'showDialog')
    .addToUi();
}

// This function opens the Index.html as a modal dialog in Google Sheets with adjusted dimensions
function showDialog() {
  var template = HtmlService.createTemplateFromFile('Index');
  template.plaidLinkToken = createLinkToken();
  var html = template.evaluate()
                     .setTitle('Bank Connector')
                     .setWidth(1000)
                     .setHeight(1000)
                     .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  SpreadsheetApp.getUi().showModalDialog(html, 'Bank Connector');
}
