/* Raast dashboard parsers: SBP monthly Raast workbook + Raast PSR template. Needs global XLSX. */
function rdNum(v){ if(v===null||v===undefined||v==='') return null; if(typeof v==='number') return isFinite(v)?v:null; var s=String(v).replace(/,/g,'').trim(); if(/^(na|n\/a|-|–)$/i.test(s)) return null; var n=parseFloat(s); return isFinite(n)?n:null; }
function rdMonthKey(v){
  if(typeof v==='number' && v>20000 && v<80000){ var d=XLSX.SSF.parse_date_code(v); return d.y+'-'+String(d.m).padStart(2,'0'); }
  if(v instanceof Date) return v.getFullYear()+'-'+String(v.getMonth()+1).padStart(2,'0');
  return null;
}
function rdRows(ws){ return XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:false}); }
function rdFindSheet(wb,re){ var n=wb.SheetNames.find(function(s){return re.test(s);}); return n?wb.Sheets[n]:null; }

function parseMonthly(wb){
  var warn=[], months={};
  function useCase(re,key){
    var ws=rdFindSheet(wb,re); if(!ws){ warn.push({lvl:'error',msg:'Sheet for '+key.toUpperCase()+' not found in the monthly file.'}); return; }
    var rows=rdRows(ws), h=-1;
    for(var i=0;i<rows.length;i++){ if((rows[i]||[]).some(function(c){return typeof c==='string'&&/volume of successful/i.test(c);})){h=i;break;} }
    if(h<0){ warn.push({lvl:'error',msg:key.toUpperCase()+' sheet: header row with "Volume of Successful…" not found.'}); return; }
    var hdr=rows[h].map(function(c){return c==null?'':String(c);});
    function col(re){ return hdr.findIndex(function(c){return re.test(c);}); }
    var cV=col(/volume of successful/i), cVal=col(/value of successful/i), cIds=col(/raast ids/i), cM=col(/raast merchants/i), cMsp=col(/msps/i), cCsp=col(/csps/i), cPart=col(/participating/i), cElig=col(/eligible/i);
    var cD=-1;
    for(var r=h+1;r<rows.length && cD<0;r++){ (rows[r]||[]).some(function(c,j){ if(rdMonthKey(c)){cD=j;return true;} return false; }); }
    for(r=h+1;r<rows.length;r++){
      var row=rows[r]||[], k=rdMonthKey(row[cD]), v=rdNum(row[cV]);
      if(!k||v===null) continue;
      var m=months[k]||(months[k]={m:k});
      m[key+'_v']=v; m[key+'_val']=rdNum(row[cVal]);
      if(key==='p2p'){ m.ids=rdNum(row[cIds]); m.banks=rdNum(row[cPart]); if(m.banks==null&&cElig>=0) m.banks=rdNum(row[cElig]); }
      if(key==='p2m'){ m.merchants=rdNum(row[cM]); m.msps=rdNum(row[cMsp]); m.csps=rdNum(row[cCsp]); }
      if(key==='bulk'){ m.bulk_inst=rdNum(row[cPart]); }
    }
  }
  useCase(/p2p/i,'p2p'); useCase(/p2m/i,'p2m'); useCase(/bulk/i,'bulk');
  var cum=null, ws=rdFindSheet(wb,/cumul/i);
  if(ws){
    rdRows(ws).forEach(function(row){
      var j=row.findIndex(function(c){return rdMonthKey(c)||(typeof c==='string'&&/launch till/i.test(c));}); if(j<0) return;
      var k=rdMonthKey(row[j]), tv=rdNum(row[j+1]), tval=rdNum(row[j+2]);
      if(k && tv!==null && tv>1e6){ var m=months[k]||(months[k]={m:k}); m.tot_v=tv/1e6; m.tot_val=tval!==null?tval/1e9:null; }
      if(!k && tv!==null && (!cum||tv/1e6>cum.vol+1e-9)){
        var asOf=(row[j].match(/(\d{1,2}\w{0,2}\s+[A-Za-z]+\s+\d{4})/)||[])[1]||'';
        var ids=rdNum(row[j+3]), mer=rdNum(row[j+4]);
        cum={label:asOf, vol:tv/1e6, val:tval/1e9, ids:ids!=null?ids/1e6:null, merchants:mer!=null?mer/1e6:null};
      }
    });
  } else warn.push({lvl:'warn',msg:'Cumulative Data sheet not found; all-use-case totals and launch-to-date figures unavailable.'});
  var list=Object.keys(months).sort().map(function(k){return months[k];}).filter(function(m){return m.p2p_v!=null||m.tot_v!=null;});
  list.forEach(function(m,i){
    if(m.bulk_v==null && m.tot_v!=null && m.p2p_v!=null){
      m.bulk_v=Math.max(0,m.tot_v-m.p2p_v-(m.p2m_v||0)); m.bulk_val=(m.tot_val!=null&&m.p2p_val!=null)?Math.max(0,m.tot_val-m.p2p_val-(m.p2m_val||0)):null; m.bulk_derived=true;
    }
    if(m.tot_v==null && m.p2p_v!=null){ m.tot_v=m.p2p_v+(m.p2m_v||0)+(m.bulk_v||0); m.tot_val=(m.p2p_val||0)+(m.p2m_val||0)+(m.bulk_val||0); }
    var p=list[i-1];
    if(p){
      if(p.ids!=null&&m.ids!=null&&m.ids<p.ids) warn.push({lvl:'warn',msg:'Raast IDs fall from '+p.ids.toFixed(2)+' Mn ('+p.m+') to '+m.ids.toFixed(2)+' Mn ('+m.m+'). Check with SBP whether IDs were cleaned up or mis-keyed.'});
      if(p.merchants!=null&&m.merchants!=null&&m.merchants===p.merchants) warn.push({lvl:'warn',msg:'P2M merchant count for '+m.m+' is identical to '+p.m+' ('+m.merchants+' Mn). Possibly a carried-over value.'});
      var pd=new Date(p.m+'-01'), md=new Date(m.m+'-01'); if((md.getFullYear()-pd.getFullYear())*12+md.getMonth()-pd.getMonth()!==1) warn.push({lvl:'warn',msg:'Gap in monthly series between '+p.m+' and '+m.m+'.'});
    }
  });
  var der=list.filter(function(m){return m.bulk_derived;}).map(function(m){return m.m;});
  if(der.length) warn.push({lvl:'info',msg:'Bulk sheet has no rows for '+der[0]+' to '+der[der.length-1]+'. Bulk for those months is derived as all-use-case total minus P2P and P2M.'});
  return {monthly:list, cumulative:cum, warnings:warn};
}

var PSR_QRE=/^Q([1-4])\s*FY\s*-?\s*(\d{2})$/i;
function rdTable(wb,re,first){
  var ws=rdFindSheet(wb,re); if(!ws) return null;
  var rows=rdRows(ws), h=rows.findIndex(function(r){return r&&typeof r[0]==='string'&&r[0].trim().toLowerCase()===first;});
  if(h<0) return null;
  var out=[]; for(var i=h+1;i<rows.length;i++){ var r=rows[i]; if(!r||r[0]==null||String(r[0]).trim()==='') continue; out.push(r); } return out;
}
function rdQ(s,warn,sheet){ var t=String(s).trim().replace(/\s+/g,' '), mm=t.match(PSR_QRE); if(!mm){warn.push({lvl:'error',msg:sheet+': quarter label "'+t+'" not recognised (use "Q1 FY26").'});return null;} return 'Q'+mm[1]+' FY'+mm[2]; }
function parsePSR(wb){
  var warn=[], quarterly=[], channels=[], eco=[], annual=[];
  var R=rdTable(wb,/raast_?q/i,'quarter');
  if(!R) warn.push({lvl:'error',msg:'Raast_Quarterly sheet (header "Quarter" in column A) not found.'});
  (R||[]).forEach(function(r){ var q=rdQ(r[0],warn,'Raast_Quarterly'); if(!q) return;
    quarterly.push({q:q,end:r[1]?String(r[1]):'',p2p_v:rdNum(r[2]),p2p_val:rdNum(r[3]),bulk_v:rdNum(r[4]),bulk_val:rdNum(r[5]),p2m_v:rdNum(r[6]),p2m_val:rdNum(r[7]),ids:rdNum(r[8]),merchants:rdNum(r[9]),src:r[10]?String(r[10]):''}); });
  var keys=['atm','atm_cw','pos','ib','mb','call','ecom','ewallet','bbwallet','dd','bbagent','branch'];
  var C=rdTable(wb,/channel/i,'quarter');
  if(!C) warn.push({lvl:'error',msg:'Channels_Quarterly sheet not found.'});
  (C||[]).forEach(function(r){ var q=rdQ(r[0],warn,'Channels_Quarterly'); if(!q) return; var o={q:q};
    keys.forEach(function(k,i){ o[k+'_v']=rdNum(r[1+i*2]); o[k+'_val']=rdNum(r[2+i*2]); });
    var miss=keys.filter(function(k){return k!=='branch'&&(o[k+'_v']==null||o[k+'_val']==null);});
    if(miss.length) warn.push({lvl:'warn',msg:q+': missing channel values ('+miss.join(', ')+'). Raast share for this quarter will be understated.'});
    channels.push(o); });
  var E=rdTable(wb,/eco/i,'quarter');
  (E||[]).forEach(function(r){ var q=rdQ(r[0],warn,'Ecosystem_Quarterly'); if(!q) return;
    eco.push({q:q,qr:rdNum(r[1]),mb:rdNum(r[2]),ib:rdNum(r[3]),bbapp:rdNum(r[4]),emi:rdNum(r[5]),cards:rdNum(r[6]),pos:rdNum(r[7]),atms:rdNum(r[8])}); });
  var A=rdTable(wb,/annual/i,'fiscal year');
  (A||[]).forEach(function(r){ var f=String(r[0]).trim().toUpperCase().replace(/\s/g,''); if(!/^FY\d{2}$/.test(f)) return;
    var o={fy:f,raast_v:rdNum(r[1]),raast_val:rdNum(r[2]),dig_v:rdNum(r[3]),dig_val:rdNum(r[4]),note:r[5]?String(r[5]):''};
    if(o.raast_v!=null||o.raast_val!=null||o.dig_v!=null||o.dig_val!=null) annual.push(o); });
  function qi(q){var m=q.match(/Q(\d) FY(\d+)/);return +m[2]*4+(+m[1]);}
  [quarterly,channels,eco].forEach(function(a){a.sort(function(x,y){return qi(x.q)-qi(y.q);});});
  return {quarterly:quarterly,channels:channels,eco:eco,annual:annual,warnings:warn};
}
if(typeof module!=='undefined') module.exports={parseMonthly:parseMonthly,parsePSR:parsePSR};
