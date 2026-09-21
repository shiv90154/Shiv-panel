require ["fileinto"];
# Rspamd marks spam with headers; deliver those into Junk.
if anyof (header :contains "X-Spam-Flag" "YES",
          header :contains "X-Spam" "Yes",
          header :contains "X-Spam-Status" "Yes") {
  fileinto "Junk";
  stop;
}
