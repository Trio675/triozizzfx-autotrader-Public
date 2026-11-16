//+------------------------------------------------------------------+
//| TZLicense.mqh                                                    |
//| TRIOZIZZFX licence check for TZ Expert Advisors (MetaTrader 5)   |
//|                                                                  |
//| A key works on ONE MT5 account: the first account that uses it.  |
//| The EA checks the key at start and every 6 hours.                |
//| Strategy Tester runs without a key so buyers can backtest.       |
//|                                                                  |
//| Buyer setup (once): MT5 -> Tools -> Options -> Expert Advisors   |
//|   tick "Allow WebRequest for listed URL" and add TZ_LICENSE_HOST |
//+------------------------------------------------------------------+
#ifndef TZ_LICENSE_MQH
#define TZ_LICENSE_MQH

#define TZ_LICENSE_HOST "https://functional-website-dba168.netlify.app"
#define TZ_LICENSE_URL  "https://functional-website-dba168.netlify.app/.netlify/functions/license"
#define TZ_RECHECK_SECS 21600     // re-check every 6 hours
#define TZ_GRACE_SECS   86400     // keep trading up to 24 h if the server can't be reached

input string LicenseKey = "";     // Licence key (TZ-XXXX-XXXX-XXXX-XXXX)

bool     TZ_Licensed     = false;
datetime TZ_LastOk       = 0;
datetime TZ_LastTry      = 0;
string   TZ_LicenseMsg   = "";

//--- returns true when this EA may trade
bool TZ_CheckLicense(const string ea_id)
{
   if(MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_OPTIMIZATION))
   {
      TZ_Licensed = true; TZ_LicenseMsg = "Strategy Tester: no licence needed";
      return true;
   }
   TZ_LastTry = TimeCurrent();
   string key = LicenseKey;
   StringTrimLeft(key); StringTrimRight(key); StringToUpper(key);
   if(StringLen(key) == 0)
   {
      TZ_Licensed = false; TZ_LicenseMsg = "Enter your LicenseKey in the EA inputs";
      return false;
   }
   long   account = AccountInfoInteger(ACCOUNT_LOGIN);
   string body    = "key=" + key + "&account=" + IntegerToString(account) + "&ea=" + ea_id;
   char   data[], result[];
   string reply_headers;
   StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, ArraySize(data) - 1);            // drop the trailing 0

   ResetLastError();
   int code = WebRequest("POST", TZ_LICENSE_URL, "Content-Type: application/x-www-form-urlencoded\r\n",
                         8000, data, result, reply_headers);
   if(code == -1 || code >= 500)
   {
      int err = GetLastError();
      if(err == 4014)
         TZ_LicenseMsg = "Allow WebRequest for " + TZ_LICENSE_HOST + " (Tools > Options > Expert Advisors)";
      else
         TZ_LicenseMsg = "Can't reach the licence server (error " + IntegerToString(err) + ")";
      // short internet drops don't stop a licensed EA
      TZ_Licensed = (TZ_LastOk > 0 && TimeCurrent() - TZ_LastOk < TZ_GRACE_SECS);
      return TZ_Licensed;
   }
   string resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   TZ_Licensed   = (StringFind(resp, "OK|") == 0);
   TZ_LicenseMsg = (StringLen(resp) > 3) ? StringSubstr(resp, 3) : resp;
   if(TZ_Licensed) TZ_LastOk = TimeCurrent();
   return TZ_Licensed;
}

//--- call from OnTimer / OnTick: re-checks every 6 hours
bool TZ_LicenseStillValid(const string ea_id)
{
   if(TimeCurrent() - TZ_LastTry >= TZ_RECHECK_SECS) TZ_CheckLicense(ea_id);
   return TZ_Licensed;
}

#endif
