/* Raast dashboard: derived metrics, CAGR and projections. Pure functions on the data object. */
var DIG_KEYS=['pos','ib','mb','call','ecom','ewallet','bbwallet','dd','bbagent'];
var CH_LABEL={atm_net:'ATM/CDM (excl. cash withdrawals)',pos:'POS',ib:'Internet Banking',mb:'Mobile Banking Apps',call:'Call Center/IVR',ecom:'E-Commerce (CNP)',ewallet:'E-Money Wallets',bbwallet:'BB/Digital Banking Apps',dd:'Direct Debit',bbagent:'BB Agents'};
function qIndex(q){var m=q.match(/Q(\d) FY(\d+)/);return +m[2]*4+(+m[1]);}
function qFY(q){return 'FY'+q.match(/FY(\d+)/)[1];}
function fyOfMonth(mk){var y=+mk.slice(0,4),m=+mk.slice(5,7);return 'FY'+String((m>=7?y+1:y)%100).padStart(2,'0');}
function qOfMonth(mk){var m=+mk.slice(5,7);var q=m>=7?(m<=9?1:2):(m<=3?3:4);return 'Q'+q+' '+fyOfMonth(mk);}
function monthsOfQ(q){var m=q.match(/Q(\d) FY(\d+)/),qn=+m[1],fy=2000+(+m[2]);var start=[7,10,1,4][qn-1],yr=qn<=2?fy-1:fy;return [0,1,2].map(function(i){return yr+'-'+String(start+i).padStart(2,'0');});}
function nz(v){return v==null?0:v;}
function cagr(a,b,n){return (a>0&&b>0&&n>0)?Math.pow(b/a,1/n)-1:null;}

function derive(D){
  var X={};
  X.q=D.quarterly.map(function(r){var o=Object.assign({},r);o.tot_v=nz(r.p2p_v)+nz(r.bulk_v)+nz(r.p2m_v);o.tot_val=nz(r.p2p_val)+nz(r.bulk_val)+nz(r.p2m_val);o.fy=qFY(r.q);return o;});
  var qmap={};X.q.forEach(function(r){qmap[r.q]=r;});
  X.ch=D.channels.map(function(c){
    var o={q:c.q,fy:qFY(c.q)};
    o.atm_net_v=c.atm_v!=null&&c.atm_cw_v!=null?c.atm_v-c.atm_cw_v:null; o.atm_net_val=c.atm_val!=null&&c.atm_cw_val!=null?c.atm_val-c.atm_cw_val:null;
    DIG_KEYS.forEach(function(k){o[k+'_v']=c[k+'_v'];o[k+'_val']=c[k+'_val'];});
    o.dig_v=nz(o.atm_net_v);o.dig_val=nz(o.atm_net_val);DIG_KEYS.forEach(function(k){o.dig_v+=nz(c[k+'_v']);o.dig_val+=nz(c[k+'_val']);});
    o.branch_v=c.branch_v;o.branch_val=c.branch_val;
    var r=qmap[c.q]; if(r){o.raast_v=r.tot_v;o.raast_val=r.tot_val;o.share_v=r.tot_v/o.dig_v;o.share_val=r.tot_val/o.dig_val;}
    return o;});
  X.ch.forEach(function(c,i){var p=X.ch[i-1];if(p){c.dig_qoq_v=c.dig_v/p.dig_v-1;c.dig_qoq_val=c.dig_val/p.dig_val-1;}});
  X.q.forEach(function(r,i){var p=X.q[i-1];if(p&&p.tot_v>0){r.qoq_v=r.tot_v/p.tot_v-1;r.qoq_val=r.tot_val/p.tot_val-1;}var y=X.q[i-4];if(y&&y.tot_v>0){r.yoy_v=r.tot_v/y.tot_v-1;r.yoy_val=r.tot_val/y.tot_val-1;}});
  // monthly
  X.m=D.monthly.map(function(m,i,a){var o=Object.assign({},m);var p=a[i-1],y=a.find(function(z){return z.m===(+m.m.slice(0,4)-1)+m.m.slice(4);});
    if(p){o.mom_v=m.tot_v/p.tot_v-1;o.mom_val=m.tot_val/p.tot_val-1;}
    if(y){o.yoy_v=m.tot_v/y.tot_v-1;o.yoy_val=m.tot_val/y.tot_val-1;o.yoy_p2m=m.p2m_v/y.p2m_v-1;}
    o.tkt_p2p=m.p2p_v?m.p2p_val/m.p2p_v*1000:null;o.tkt_p2m=m.p2m_v?m.p2m_val/m.p2m_v*1000:null;o.tkt_bulk=m.bulk_v?m.bulk_val/m.bulk_v*1000:null;
    return o;});
  // annual
  X.fy=buildFY(D,X);
  X.cum=D.cumulative;
  return X;
}

function buildFY(D,X){
  var fys={};
  X.q.forEach(function(r){var f=fys[r.fy]||(fys[r.fy]={fy:r.fy,qs:[],raast_v:0,raast_val:0,p2p_v:0,p2m_v:0,bulk_v:0,p2p_val:0,p2m_val:0,bulk_val:0,dig_v:0,dig_val:0,dqs:0});
    f.qs.push(r.q);['p2p','p2m','bulk'].forEach(function(k){f[k+'_v']+=nz(r[k+'_v']);f[k+'_val']+=nz(r[k+'_val']);});f.raast_v+=r.tot_v;f.raast_val+=r.tot_val;});
  X.ch.forEach(function(c){var f=fys[c.fy];if(!f)return;f.dig_v+=c.dig_v;f.dig_val+=c.dig_val;f.dqs++;});
  var list=Object.keys(fys).sort().map(function(k){return fys[k];});
  list.forEach(function(f){f.complete=f.qs.length===4;f.digComplete=f.dqs===4;f.basis=f.complete?'actual':'partial';});
  // extend the latest FY with monthly data beyond the last PSR quarter, then run-rate the rest
  var last=list[list.length-1], months=X.m;
  var nNewFY=months.length?months.filter(function(m){return fyOfMonth(m.m)===fyOfMonth(months[months.length-1].m);}).length:0;
  /* a fiscal year with no PSR quarters yet is only estimated once 6+ months of monthly data exist */
  if(months.length && (fys[fyOfMonth(months[months.length-1].m)] || nNewFY>=6)){
    var lastM=months[months.length-1], mfy=fyOfMonth(lastM.m);
    if(!fys[mfy]){ fys[mfy]={fy:mfy,qs:[],raast_v:0,raast_val:0,p2p_v:0,p2m_v:0,bulk_v:0,p2p_val:0,p2m_val:0,bulk_val:0,dig_v:0,dig_val:0,dqs:0,complete:false,digComplete:false}; list.push(fys[mfy]); last=fys[mfy]; }
    if(last.fy===mfy && !last.complete){
      var covered={};last.qs.forEach(function(q){monthsOfQ(q).forEach(function(mk){covered[mk]=1;});});
      var add=months.filter(function(m){return fyOfMonth(m.m)===mfy&&!covered[m.m];});
      add.forEach(function(m){['p2p','p2m','bulk'].forEach(function(k){last[k+'_v']+=nz(m[k+'_v']);last[k+'_val']+=nz(m[k+'_val']);});last.raast_v+=m.tot_v;last.raast_val+=m.tot_val;});
      var nKnown=last.qs.length*3+add.length, nLeft=12-nKnown;
      var rr=months.slice(-3), rrV=rr.reduce(function(s,m){return s+m.tot_v;},0)/rr.length, rrVal=rr.reduce(function(s,m){return s+m.tot_val;},0)/rr.length;
      if(nLeft>0){last.raast_v+=rrV*nLeft;last.raast_val+=rrVal*nLeft;
        ['p2p','p2m','bulk'].forEach(function(k){var a=rr.reduce(function(s,m){return s+nz(m[k+'_v']);},0)/rr.length,b=rr.reduce(function(s,m){return s+nz(m[k+'_val']);},0)/rr.length;last[k+'_v']+=a*nLeft;last[k+'_val']+=b*nLeft;});}
      last.basis='estimate'; last.estNote=last.qs.length+' PSR quarter'+(last.qs.length===1?'':'s')+' + '+add.length+' month'+(add.length===1?'':'s')+' of SBP monthly data'+(nLeft>0?' + '+nLeft+' month'+(nLeft===1?'':'s')+' at the latest 3-month run-rate':'');
      last.monthsActual=nKnown;
    }
    // digital universe for the partial FY: scale the known quarters by last year's seasonality
    if(!last.digComplete && last.dqs>0){
      var prev=fys['FY'+String(+last.fy.slice(2)-1).padStart(2,'0')];
      if(prev&&prev.digComplete){
        var lastQs=X.ch.filter(function(c){return c.fy===last.fy;}).map(function(c){return +c.q[1];});
        var prevPart=X.ch.filter(function(c){return c.fy===prev.fy&&lastQs.indexOf(+c.q[1])>=0;});
        var pv=prevPart.reduce(function(s,c){return s+c.dig_v;},0),pval=prevPart.reduce(function(s,c){return s+c.dig_val;},0);
        last.dig_v=last.dig_v*prev.dig_v/pv;last.dig_val=last.dig_val*prev.dig_val/pval;last.digEst=true;
      }
    }
  }
  // SBP annual overrides
  (D.annual||[]).forEach(function(a){var f=fys[a.fy];if(!f)return;
    if(a.raast_v!=null){f.raast_v=a.raast_v;f.basis='sbp-annual';}if(a.raast_val!=null)f.raast_val=a.raast_val;
    if(a.dig_v!=null){f.dig_v=a.dig_v;f.digComplete=true;f.digEst=false;}if(a.dig_val!=null)f.dig_val=a.dig_val;});
  list.forEach(function(f){f.label=f.fy+(f.basis==='estimate'?'E':'');f.share_v=f.dig_v?f.raast_v/f.dig_v:null;f.share_val=f.dig_val?f.raast_val/f.dig_val:null;});
  return list.filter(function(f){return f.basis!=='partial';});
}

function growthTable(X){
  var fy=X.fy, L=fy[fy.length-1];
  function row(label,get,minBase){
    var out={label:label,latest:get(L),latestFY:L.label,c:{}};
    [1,2,3].forEach(function(n){var b=fy[fy.length-1-n];var a=b?get(b):null;var v=cagr(a,get(L),n);out.c[n]={v:v,base:b?b.label:null,small:a!=null&&minBase!=null&&a<minBase};});
    return out;}
  return [
    row('Raast volume',function(f){return f.raast_v;},10),
    row('Raast value',function(f){return f.raast_val;},100),
    row('P2P volume',function(f){return f.p2p_v;},10),
    row('P2M volume',function(f){return f.p2m_v;},5),
    row('Bulk volume',function(f){return f.bulk_v;},1),
    row('Digital payments volume',function(f){return f.digComplete||f.digEst?f.dig_v:null;},null),
    row('Digital payments value',function(f){return f.digComplete||f.digEst?f.dig_val:null;},null)
  ];
}

/* opts: {metric:'v'|'val', window:1|2|3, longRun:0.25, ceiling:0.75} */
function project(X,opts){
  var fy=X.fy, L=fy[fy.length-1], n=opts.window, B=fy[fy.length-1-n];
  var rk=opts.metric==='v'?'raast_v':'raast_val', dk=opts.metric==='v'?'dig_v':'dig_val';
  var g0=B?cagr(B[rk],L[rk],n):null;
  var digB=fy.filter(function(f){return f.digComplete||f.digEst;}), DL=digB[digB.length-1], DB=digB[digB.length-1-Math.min(n,digB.length-1)];
  var gd=(DB&&DL&&DB!==DL)?cagr(DB[dk],DL[dk],digB.indexOf(DL)-digB.indexOf(DB)):null;
  var gL=opts.longRun, cap=opts.ceiling, y0=+L.fy.slice(2);
  var years=[],hist=[],base=[],cons=[],dig=[],shareBase=[],shareHist=[],capped=[];
  var h=L[rk],b=L[rk],c=L[rk],d=L[dk];
  for(var k=1;k<=5;k++){
    var gb=g0+(gL-g0)*k/5, gc=gL+(g0-gL)*Math.pow(0.5,k), gdk=gd!=null?gd+(gL-gd)*k/5:gL;
    h*=1+g0; b*=1+gb; c*=1+gc; d*=1+gdk;
    var capHit=false; if(b>cap*d){b=cap*d;capHit=true;} if(c>cap*d){c=cap*d;}
    years.push('FY'+(y0+k)); hist.push(h); base.push(b); cons.push(c); dig.push(d); shareBase.push(b/d); shareHist.push(h/d); capped.push(capHit);
  }
  return {from:L.label,base0:L[rk],dig0:L[dk],g0:g0,gd:gd,gL:gL,cap:cap,window:n,baseLabel:B?B.label:null,years:years,hist:hist,base:base,cons:cons,dig:dig,shareBase:shareBase,shareHist:shareHist,capped:capped};
}
if(typeof module!=='undefined') module.exports={derive:derive,growthTable:growthTable,project:project};
