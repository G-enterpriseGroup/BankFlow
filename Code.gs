// === Plaid Configuration ===
const PLAID_CLIENT_ID = "67dda9a14dadc400239e94bd"; // replace with your client id
const PLAID_SECRET = "cdf038b089e2dc3a409310237cc79f"; // replace with your secret
const PLAID_ENV = "sandbox"; // change if needed
const PLAID_BASE_URL = "https://sandbox.plaid.com";

/**
 * Dynamically create a Plaid Link token
 */
function createLinkToken() {
  var url = PLAID_BASE_URL + "/link/token/create";
  var payload = {
    client_id: PLAID_CLIENT_ID,
    secret: PLAID_SECRET,
    client_name: "Your App Name", // Adjust as desired
    user: { client_user_id: "unique_user_id" }, // Adjust as desired
    products: ["auth", "transactions"],
    country_codes: ["US"],
    language: "en"
  };
  
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var result = JSON.parse(response.getContentText());
  if (result.error) {
    Logger.log("Error creating link token: " + result.error);
    return null;
  }
  return result.link_token;
}

/**
 * Return the Index.html with the Plaid Link token injected
 */
function doGet() {
  var template = HtmlService.createTemplateFromFile("Index");
  template.plaidLinkToken = createLinkToken();
  return template.evaluate();
}

/**
 * A helper function to inject CSS from a separate file
 */
function include(filename) {
  return HtmlService.createTemplateFromFile(filename).getRawContent();
}

/**
 * Exchange a public token for an access token and store it (supports up to 9 accounts)
 */
function exchangePublicToken(publicToken) {
  var url = PLAID_BASE_URL + "/item/public_token/exchange";
  var payload = {
    client_id: PLAID_CLIENT_ID,
    secret: PLAID_SECRET,
    public_token: publicToken
  };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var result = JSON.parse(response.getContentText());
  
  if (result.error) {
    Logger.log("Error exchanging token: " + result.error);
    return;
  }
  
  var accessToken = result.access_token;
  
  // Use UserProperties for per-user storage
  var userProperties = PropertiesService.getUserProperties();
  var tokens = userProperties.getProperty("ACCESS_TOKENS");
  var tokensArray = tokens ? JSON.parse(tokens) : [];
  
  if (tokensArray.length >= 9) {
    Logger.log("Maximum of 9 bank accounts already linked.");
    return;
  }
  
  if (tokensArray.indexOf(accessToken) === -1) {
    tokensArray.push(accessToken);
    userProperties.setProperty("ACCESS_TOKENS", JSON.stringify(tokensArray));
  }
}

/**
 * Fetch high-level info about each linked account (bank name & total balance).
 * Returns an array of objects so the HTML can display them.
 */
function getLinkedAccountsDetails() {
  var userProperties = PropertiesService.getUserProperties();
  var tokens = userProperties.getProperty("ACCESS_TOKENS");
  if (!tokens) {
    return [];
  }
  
  var tokensArray = JSON.parse(tokens);
  var detailsArray = [];
  
  for (var i = 0; i < tokensArray.length; i++) {
    var token = tokensArray[i];
    
    // Get item to retrieve institution_id
    var itemUrl = PLAID_BASE_URL + "/item/get";
    var itemPayload = {
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      access_token: token
    };
    var itemOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(itemPayload)
    };
    var itemResponse = UrlFetchApp.fetch(itemUrl, itemOptions);
    var itemResult = JSON.parse(itemResponse.getContentText());
    if (itemResult.error) {
      Logger.log("Error fetching item for token: " + token);
      continue;
    }
    var institutionId = itemResult.item.institution_id || null;
    
    // Attempt to fetch institution name
    var institutionName = "Unknown Institution";
    if (institutionId) {
      var institutionUrl = PLAID_BASE_URL + "/institutions/get_by_id";
      var institutionPayload = {
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        institution_id: institutionId,
        country_codes: ["US"]
      };
      var institutionOptions = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(institutionPayload)
      };
      var institutionResponse = UrlFetchApp.fetch(institutionUrl, institutionOptions);
      var institutionResult = JSON.parse(institutionResponse.getContentText());
      if (!institutionResult.error) {
        institutionName = institutionResult.institution.name;
      }
    }
    
    // Fetch balances to compute total
    var balanceUrl = PLAID_BASE_URL + "/accounts/balance/get";
    var balancePayload = {
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      access_token: token
    };
    var balanceOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(balancePayload)
    };
    var balanceResponse = UrlFetchApp.fetch(balanceUrl, balanceOptions);
    var balanceResult = JSON.parse(balanceResponse.getContentText());
    if (balanceResult.error) {
      Logger.log("Error fetching balances for token: " + token);
      continue;
    }
    
    var accounts = balanceResult.accounts || [];
    var totalBalance = 0;
    for (var j = 0; j < accounts.length; j++) {
      var acc = accounts[j];
      totalBalance += (acc.balances.current || 0);
    }
    
    detailsArray.push({
      token: token,
      institutionName: institutionName,
      totalBalance: totalBalance
    });
  }
  
  return detailsArray;
}

/**
 * Fetch balances and transactions for all linked accounts, populate two sheets
 */
function updateData() {
  var userProperties = PropertiesService.getUserProperties();
  var tokens = userProperties.getProperty("ACCESS_TOKENS");
  if (!tokens) {
    Logger.log("No bank accounts linked.");
    return;
  }
  
  var tokensArray = JSON.parse(tokens);
  var allBalances = [];
  var allTransactions = [];
  
  // Define dates for transactions: last 30 days
  var endDate = new Date();
  var startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);
  var startDateStr = Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var endDateStr = Utilities.formatDate(endDate, Session.getScriptTimeZone(), "yyyy-MM-dd");

  for (var i = 0; i < tokensArray.length; i++) {
    var token = tokensArray[i];
    
    // --- Fetch Account Balances ---
    var balanceUrl = PLAID_BASE_URL + "/accounts/balance/get";
    var balancePayload = {
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      access_token: token
    };
    
    var balanceOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(balancePayload),
      muteHttpExceptions: true
    };
    
    var balanceResponse = UrlFetchApp.fetch(balanceUrl, balanceOptions);
    var balanceResult = JSON.parse(balanceResponse.getContentText());
    
    if (balanceResult.error) {
      Logger.log("Error fetching balance for token: " + token);
      continue;
    }
    
    var accounts = balanceResult.accounts;
    // For each account, capture key details with a column for Bank Identifier (token)
    for (var j = 0; j < accounts.length; j++) {
      var acc = accounts[j];
      allBalances.push([
        token,                            // Bank Identifier (or token reference)
        acc.name,
        acc.official_name || "",
        acc.type,
        acc.subtype,
        acc.balances.current,
        acc.balances.available || ""
      ]);
    }
    
    // --- Fetch Transactions (last 30 days) ---
    var transactionsUrl = PLAID_BASE_URL + "/transactions/get";
    var transactionsPayload = {
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      access_token: token,
      start_date: startDateStr,
      end_date: endDateStr,
      options: {
        count: 500,
        offset: 0
      }
    };
    
    var transactionsOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(transactionsPayload),
      muteHttpExceptions: true
    };
    
    var transactionsResponse = UrlFetchApp.fetch(transactionsUrl, transactionsOptions);
    var transactionsResult = JSON.parse(transactionsResponse.getContentText());
    
    if (transactionsResult.error) {
      Logger.log("Error fetching transactions for token: " + token);
      continue;
    }
    
    var transactions = transactionsResult.transactions;
    // For each transaction, capture details with bank token reference
    for (var k = 0; k < transactions.length; k++) {
      var txn = transactions[k];
      allTransactions.push([
        token,
        txn.date,
        txn.name,
        txn.amount,
        (txn.category && txn.category.length > 0) ? txn.category[0] : "",
        txn.account_id,
        txn.transaction_id
      ]);
    }
  }
  
  // --- Populate Sheets ---
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Balances sheet: Create or clear existing sheet
  var balancesSheet = ss.getSheetByName("Balances");
  if (!balancesSheet) {
    balancesSheet = ss.insertSheet("Balances");
  } else {
    balancesSheet.clear();
  }
  var balanceHeaders = ["Bank Identifier", "Account Name", "Official Name", "Account Type", "Sub-Type", "Current Balance", "Available Balance"];
  balancesSheet.appendRow(balanceHeaders);
  if (allBalances.length > 0) {
    balancesSheet.getRange(2, 1, allBalances.length, balanceHeaders.length).setValues(allBalances);
  }
  
  // Transactions sheet: Create or clear existing sheet
  var transactionsSheet = ss.getSheetByName("Transactions");
  if (!transactionsSheet) {
    transactionsSheet = ss.insertSheet("Transactions");
  } else {
    transactionsSheet.clear();
  }
  var transactionHeaders = ["Bank Identifier", "Date", "Name", "Amount", "Category", "Account ID", "Transaction ID"];
  transactionsSheet.appendRow(transactionHeaders);
  if (allTransactions.length > 0) {
    transactionsSheet.getRange(2, 1, allTransactions.length, transactionHeaders.length).setValues(allTransactions);
  }
}
