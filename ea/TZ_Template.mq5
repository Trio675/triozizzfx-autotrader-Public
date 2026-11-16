//+------------------------------------------------------------------+
//| TZ_Template.mq5 — starting point for every TZ Expert Advisor     |
//| Copy it, set TZ_EA_ID and the version, then add the strategy.    |
//+------------------------------------------------------------------+
#property copyright "TRIOZIZZFX"
#property version   "1.00"

#define TZ_EA_ID "tz-v1.0"        // must match the EA's id in the shop
#include "TZLicense.mqh"

int OnInit()
{
   if(!TZ_CheckLicense(TZ_EA_ID))
   {
      Alert("TRIOZIZZFX licence: ", TZ_LicenseMsg);
      Comment("TRIOZIZZFX licence: ", TZ_LicenseMsg);
      return(INIT_FAILED);
   }
   Comment("TRIOZIZZFX ", TZ_EA_ID, " · ", TZ_LicenseMsg);
   EventSetTimer(600);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { EventKillTimer(); Comment(""); }

void OnTimer()
{
   if(!TZ_LicenseStillValid(TZ_EA_ID)) Comment("TRIOZIZZFX licence: ", TZ_LicenseMsg, " — trading paused");
}

void OnTick()
{
   if(!TZ_Licensed) return;        // no valid licence: no new trades
   // ---- strategy goes here ----
}
