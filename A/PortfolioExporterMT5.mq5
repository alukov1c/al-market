#property strict
#property version "1.11"
// Izvoz podataka bez slanja ili menjanja trgovačkih naloga.
input int RefreshSeconds = 5;
input long ExpectedLogin = 0;
input string ConversionSymbol = "";
#ifdef __MQL5__
string PortfolioId = "A";
string Platform = "MT5";
#else
string PortfolioId = "B";
string Platform = "MT4";
#endif
string JsonString(string value) {
   StringReplace(value,"\\","\\\\"); StringReplace(value,"\"","\\\"");
   StringReplace(value,"\r"," "); StringReplace(value,"\n"," "); StringReplace(value,"\t"," ");
   return "\""+value+"\"";
}
string NumberJson(double value) {
   return MathIsValidNumber(value) ? DoubleToString(value,8) : "null";
}
// Izbor poslednje zatvorene trgovine prema vremenu, nezavisno od redosleda tabele.
string LastTrade(bool &available) {
   long latest=0;
   string ticketText="", symbol="", kind="";
   double profit=0, swap=0;
   available=true;
#ifdef __MQL5__
   if(!HistorySelect(0,TimeCurrent())) { available=false; return "null"; }
   ulong best=0;
   for(int i=0;i<HistoryDealsTotal();i++) {
      ulong ticket=HistoryDealGetTicket(i);
      if(ticket==0) { available=false; continue; }
      long type=HistoryDealGetInteger(ticket,DEAL_TYPE);
      long entry=HistoryDealGetInteger(ticket,DEAL_ENTRY);
      if((type!=DEAL_TYPE_BUY && type!=DEAL_TYPE_SELL) ||
         (entry!=DEAL_ENTRY_OUT && entry!=DEAL_ENTRY_OUT_BY && entry!=DEAL_ENTRY_INOUT)) continue;
      long stamp=HistoryDealGetInteger(ticket,DEAL_TIME_MSC);
      if(stamp>latest || (stamp==latest && ticket>best)) {
         latest=stamp; best=ticket;
         profit=HistoryDealGetDouble(ticket,DEAL_PROFIT);
         swap=HistoryDealGetDouble(ticket,DEAL_SWAP);
         symbol=HistoryDealGetString(ticket,DEAL_SYMBOL);
         kind=EnumToString((ENUM_DEAL_TYPE)HistoryDealGetInteger(ticket,DEAL_TYPE));
         ticketText=IntegerToString((long)ticket);
      }
   }
#else
   int best=0;
   for(int i=0;i<OrdersHistoryTotal();i++) {
      if(!OrderSelect(i,SELECT_BY_POS,MODE_HISTORY)) { available=false; continue; }
      if((OrderType()!=OP_BUY && OrderType()!=OP_SELL) || OrderCloseTime()<=0) continue;
      long stamp=(long)OrderCloseTime()*1000;
      if(stamp>latest || (stamp==latest && OrderTicket()>best)) {
         latest=stamp; best=OrderTicket(); profit=OrderProfit(); swap=OrderSwap();
         symbol=OrderSymbol(); kind=IntegerToString(OrderType()); ticketText=IntegerToString(best);
      }
   }
#endif
   if(latest<=0) return "null";
   return "{\"profit\":"+NumberJson(profit)+",\"swap\":"+NumberJson(swap)+
      ",\"closedAt\":"+JsonString(TimeToString((datetime)(latest/1000),TIME_DATE|TIME_SECONDS))+
      ",\"ticket\":"+JsonString(ticketText)+",\"symbol\":"+JsonString(symbol)+",\"kind\":"+JsonString(kind)+"}";
}
// Pronalaženje direktnog ili obrnutog kursa preko valutnih svojstava brokerskog simbola.
double QuoteRate(string symbol,string from,string to,double &age) {
   string base=SymbolInfoString(symbol,SYMBOL_CURRENCY_BASE);
   string quote=SymbolInfoString(symbol,SYMBOL_CURRENCY_PROFIT);
   bool direct=base==from && quote==to;
   bool inverse=base==to && quote==from;
   if(!direct && !inverse) return 0;
   if(!SymbolSelect(symbol,true)) return 0;
   MqlTick tick;
   if(!SymbolInfoTick(symbol,tick) || tick.bid<=0 || tick.ask<=0) return 0;
   age=(double)(TimeCurrent()-tick.time);
   if(age<0 || age>120) return 0;
   double mid=(tick.bid+tick.ask)/2;
   return direct ? mid : 1/mid;
}
double DirectRate(string from,string to,double &age,string preferred="") {
   age=0;
   if(from==to) return 1;
   if(from=="" || to=="") return 0;
   if(preferred!="") return QuoteRate(preferred,from,to,age);
   for(int i=0;i<SymbolsTotal(false);i++) {
      string symbol=SymbolName(i,false);
      double rate=QuoteRate(symbol,from,to,age);
      if(rate>0) return rate;
   }
   return 0;
}
double CurrencyRate(string from,string to,double &age,string preferred="") {
   double rate=DirectRate(from,to,age,preferred);
   if(rate>0 || preferred!="" || from=="USD" || to=="USD") return rate;
   double firstAge=0,secondAge=0;
   double first=DirectRate(from,"USD",firstAge);
   double second=DirectRate("USD",to,secondAge);
   age=MathMax(firstAge,secondAge);
   return first>0 && second>0 ? first*second : 0;
}
// Zbir bruto tržišnih vrednosti otvorenih pozicija u valuti računa.
string PositionValues(string currency,double &total,bool &complete,int &count) {
   string result="[";
   total=0; count=0; complete=true;
#ifdef __MQL5__
   int size=PositionsTotal();
#else
   int size=OrdersTotal();
#endif
   for(int i=0;i<size;i++) {
      string symbol;
      double volume,price,contract;
#ifdef __MQL5__
      if(PositionGetTicket(i)==0) { complete=false; continue; }
      symbol=PositionGetString(POSITION_SYMBOL);
      volume=PositionGetDouble(POSITION_VOLUME);
      price=PositionGetDouble(POSITION_PRICE_CURRENT);
      contract=SymbolInfoDouble(symbol,SYMBOL_TRADE_CONTRACT_SIZE);
#else
      if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES)) { complete=false; continue; }
      if(OrderType()!=OP_BUY && OrderType()!=OP_SELL) continue;
      symbol=OrderSymbol(); volume=OrderLots(); price=OrderClosePrice();
      contract=MarketInfo(symbol,MODE_LOTSIZE);
#endif
      string quote=SymbolInfoString(symbol,SYMBOL_CURRENCY_PROFIT);
      double age=0;
      double rate=CurrencyRate(quote,currency,age);
      bool valid=volume>0 && price>0 && contract>0 && rate>0;
      double value=volume*contract*price*rate;
      if(!MathIsValidNumber(value)) valid=false;
      if(valid) total+=value; else complete=false;
      if(count>0) result+=",";
      result+="{\"symbol\":"+JsonString(symbol)+",\"volume\":"+NumberJson(volume)+
         ",\"contractSize\":"+NumberJson(contract)+",\"price\":"+NumberJson(price)+
         ",\"quoteCurrency\":"+JsonString(quote)+",\"fxToAccount\":"+(rate>0 ? NumberJson(rate) : "null")+
         ",\"marketValue\":"+(valid ? NumberJson(value) : "null")+"}";
      count++;
   }
   return result+"]";
}
void ExportPortfolio() {
   long login;
   double balance,equity,margin;
   string currency;
#ifdef __MQL5__
   login=AccountInfoInteger(ACCOUNT_LOGIN); balance=AccountInfoDouble(ACCOUNT_BALANCE);
   equity=AccountInfoDouble(ACCOUNT_EQUITY); margin=AccountInfoDouble(ACCOUNT_MARGIN);
   currency=AccountInfoString(ACCOUNT_CURRENCY);
#else
   login=AccountNumber(); balance=AccountBalance(); equity=AccountEquity(); margin=AccountMargin(); currency=AccountCurrency();
#endif
   if(login<=0 || (ExpectedLogin!=0 && login!=ExpectedLogin)) return;
   bool connected=(bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   bool historyAvailable,positionsComplete;
   double marketValue,fxAge;
   int positionCount;
   string last=LastTrade(historyAvailable);
   string positions=PositionValues(currency,marketValue,positionsComplete,positionCount);
   double fx=CurrencyRate(currency,"CHF",fxAge,ConversionSymbol);
   string payload="{\"schemaVersion\":2,\"exporterBuild\":\"1.11\",\"historyMode\":\"closed-trades\",\"portfolio\":"+JsonString(PortfolioId)+",\"platform\":"+JsonString(Platform)+
      ",\"login\":"+JsonString(IntegerToString(login))+",\"currency\":"+JsonString(currency)+
      ",\"balance\":"+NumberJson(balance)+",\"equity\":"+NumberJson(equity)+",\"margin\":"+NumberJson(margin)+
      ",\"connected\":"+(connected ? "true" : "false")+",\"exportedAt\":"+IntegerToString((long)TimeGMT())+
      ",\"fxToCHF\":"+(fx>0 ? NumberJson(fx) : "null")+",\"fxAgeSeconds\":"+NumberJson(fxAge)+
      ",\"historyAvailable\":"+(historyAvailable ? "true" : "false")+",\"lastTrade\":"+last+
      ",\"positionsComplete\":"+(positionsComplete ? "true" : "false")+",\"positionCount\":"+IntegerToString(positionCount)+
      ",\"marketValue\":"+(positionsComplete ? NumberJson(marketValue) : "null")+",\"positions\":"+positions+"}";
   FolderCreate("al-market",FILE_COMMON);
   string target="al-market\\portfolio-"+PortfolioId+".json", temporary=target+".tmp";
   int handle=FileOpen(temporary,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON,0,CP_UTF8);
   if(handle==INVALID_HANDLE) { Print("Export: FileOpen ",GetLastError()); return; }
   uint written=FileWriteString(handle,payload);
   FileFlush(handle); FileClose(handle);
   if(written==0 || !FileMove(temporary,FILE_COMMON,target,FILE_COMMON|FILE_REWRITE)) Print("Export: FileMove ",GetLastError());
}
int OnInit() {
   if(RefreshSeconds<1) return INIT_PARAMETERS_INCORRECT;
   if(!EventSetTimer(RefreshSeconds)) return INIT_FAILED;
   ExportPortfolio(); return INIT_SUCCEEDED;
}
void OnTick() {}
void OnTimer() { ExportPortfolio(); }
void OnDeinit(const int reason) { EventKillTimer(); }
