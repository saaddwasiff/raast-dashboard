/* Raast dashboard: read SBP Payment Systems Review (quarterly) PDFs. Needs a pdfjsLib object. */
function psrLines(pdfjs, buf){
  return pdfjs.getDocument({data:buf, isEvalSupported:false}).promise.then(function(doc){
    var pages=[]; for(var i=1;i<=doc.numPages;i++) pages.push(i);
    return Promise.all(pages.map(function(n){return doc.getPage(n).then(function(p){return p.getTextContent();}).then(function(tc){
      var rows=[];
      tc.items.forEach(function(it){ if(!it.str||!it.str.trim()) return; var y=it.transform[5], x=it.transform[4], fs=Math.abs(it.transform[0])||8;
        var r=rows.find(function(r){return Math.abs(r.y-y)<2.5;}); if(!r){r={y:y,items:[]};rows.push(r);} r.items.push({x:x,w:it.width||0,fs:fs,s:it.str}); });
      rows.sort(function(a,b){return b.y-a.y;});
      return rows.map(function(r){ var its=r.items.sort(function(a,b){return a.x-b.x;}), out='', prev=null;
        its.forEach(function(i){ var gap=prev?i.x-(prev.x+prev.w):99;
          /* glyph runs split inside a word or number sit almost flush; real column gaps are wide */
          out+= (prev && gap < prev.fs*0.18 && !/\s$/.test(prev.s) && !/^\s/.test(i.s)) ? i.s : (out?' ':'')+i.s; prev=i; });
        return out.replace(/\s+/g,' ').replace(/([A-Za-z0-9])\s*-\s*(?=[A-Za-z])/g,'$1-').replace(/\b([A-Za-z])\s*-\s*(?=\d)/g,'$1-').replace(/\s*\/\s*/g,'/').replace(/\s+:/g,':').trim(); });
    });}));
  }).then(function(perPage){return [].concat.apply([],perPage);});
}
var PSR_Q=/Q\s*([1-4])\s*-\s*F\s*Y\s*-?\s*(\d)\s*(\d)/gi;
function psrNums(line){ var m=line.match(/(?:^|\s)-?\d[\d,]*\.?\d*(?=\s|$)/g)||[]; return m.map(function(s){return parseFloat(s.replace(/,/g,'').trim());}); }
function psrSection(lines, headRe){
  var start=lines.findIndex(function(l){return headRe.test(l)&&!/\.{4,}/.test(l);}); if(start<0) return null;
  var end=lines.length; for(var i=start+1;i<lines.length;i++){ if(/^A-\d+\s*:/.test(lines[i])&&!/\.{4,}/.test(lines[i])){end=i;break;} }
  var sec=lines.slice(start,end), qs=null;
  for(var j=0;j<sec.length&&!qs;j++){ var mm=[],m; PSR_Q.lastIndex=0; while((m=PSR_Q.exec(sec[j]))) mm.push('Q'+m[1]+' FY'+m[2]+m[3]); if(mm.length>=3) qs=mm.filter(function(q,k){return mm.indexOf(q)===k;}); }
  return {lines:sec, quarters:qs};
}
function psrSplit(line){ var t=line.split(' '), i=t.findIndex(function(x){return /^-?[\d,]+\.?\d*$/.test(x)&&/\d/.test(x);}); if(i<0) return {key:line.replace(/\s+/g,'').toLowerCase(),nums:[]};
  return {key:t.slice(0,i).join('').toLowerCase(), nums:t.slice(i).filter(function(x){return /^-?[\d,]+\.?\d*$/.test(x);}).map(function(x){return parseFloat(x.replace(/,/g,''));})}; }
function psrRow(sec, re, n){ for(var i=0;i<sec.lines.length;i++){ var p=psrSplit(sec.lines[i]); if(re.test(p.key)&&p.nums.length>=n) return p.nums.slice(-n); } return null; }
function parsePSRText(lines){
  var warn=[], out={quarterly:{},channels:{},eco:{}};
  /* Raast */
  var R=psrSection(lines,/^A-\d+\s*:\s*Raast/i);
  if(!R||!R.quarters) warn.push({lvl:'error',msg:'PDF: Raast annexure table not found.'});
  else { var nq=R.quarters.length, rows={p2p:/^p2p/,bulk:/^bulk/,p2m:/^p2m/};
    Object.keys(rows).forEach(function(k){ var v=psrRow(R,rows[k],nq*2); if(!v){ if(k!=='p2m') warn.push({lvl:'warn',msg:'PDF: Raast '+k.toUpperCase()+' row not read.'}); return; }
      R.quarters.forEach(function(q,i){ var o=out.quarterly[q]||(out.quarterly[q]={q:q}); o[k+'_v']=v[i*2]; o[k+'_val']=v[i*2+1]; }); }); }
  /* Retail payments by channel */
  var C=psrSection(lines,/^A-\d+\s*:\s*Retail Value Payments/i);
  var chRe=[['atm',/^atm/],['pos',/^pos/],['ib',/^internetbanking/],['mb',/^mobile(phone)?banking/],['call',/^callcent/],['ecom',/^e-?commerce/],['bbwallet',/^(bbwallet|branchless\/digitalbankingapps)/],['ewallet',/^e-?(money)?wallet/],['dd',/^directdebit/],['bbagent',/^(bbagent|bankingagents?)/],['branch',/^bankbranch/]];
  if(!C||!C.quarters) warn.push({lvl:'error',msg:'PDF: Retail Value Payments (A-4) table not found.'});
  else chRe.forEach(function(p){ var v=psrRow(C,p[1],C.quarters.length*2); if(!v){warn.push({lvl:'error',msg:'PDF: channel row "'+p[0]+'" not read from A-4.'});return;}
    C.quarters.forEach(function(q,i){ var o=out.channels[q]||(out.channels[q]={q:q}); o[p[0]+'_v']=v[i*2]; o[p[0]+'_val']=v[i*2+1]; }); });
  /* ATM cash withdrawals */
  var A=psrSection(lines,/^A-\d+\s*:\s*ATM/i);
  var cw=A&&A.quarters?psrRow(A,/^cashwithdrawals/,A.quarters.length*2):null;
  if(!cw) warn.push({lvl:'error',msg:'PDF: ATM cash withdrawals (A-5) not read; ATM cannot be netted.'});
  else A.quarters.forEach(function(q,i){ var o=out.channels[q]||(out.channels[q]={q:q}); o.atm_cw_v=cw[i*2]; o.atm_cw_val=cw[i*2+1]; });
  /* Infrastructure and users */
  var I=psrSection(lines,/^A-\d+\s*:\s*Payment Systems Infrastructure/i);
  if(!I||!I.quarters) warn.push({lvl:'warn',msg:'PDF: Infrastructure table (A-1) not found; ecosystem figures not updated.'});
  else { var n=I.quarters.length, ecoRe=[['qr',/^qr-?enabledmerchants/,1],['mb',/^mobilephonebankingusers/,1e6],['ib',/^internetbankingusers/,1e6],['bbapp',/^branchlessbankingmobileappusers/,1e6],['emi',/^emi-?wallet/,1e6],['cards',/^paymentcards$/,1e6],['pos',/^posmachines/,1],['atms',/^atms$/,1]];
    ecoRe.forEach(function(p){ var v=psrRow(I,p[1],n); if(!v) return; I.quarters.forEach(function(q,i){ var o=out.eco[q]||(out.eco[q]={q:q}); o[p[0]]=p[2]===1?v[i]:Math.round(v[i]/p[2]*100)/100; }); }); }
  var qs=Object.keys(out.channels).concat(Object.keys(out.quarterly));
  var latest=qs.sort(function(a,b){return qIndexP(a)-qIndexP(b);}).pop()||null;
  return {quarterly:out.quarterly,channels:out.channels,eco:out.eco,latest:latest,warnings:warn};
}
function qIndexP(q){var m=q.match(/Q(\d) FY(\d+)/);return +m[2]*4+(+m[1]);}
/* Merge PDF results into the dashboard data. A quarter is only replaced by an issue at least as recent
   as the issue its current figures came from, so loading an old PSR never undoes later revisions. */
var PSR_NAMES={atm:'ATM/CDM',atm_cw:'ATM cash withdrawals',pos:'POS',ib:'Internet Banking',mb:'Mobile Banking Apps',call:'Call Center/IVR',ecom:'E-Commerce',ewallet:'E-Money Wallets',bbwallet:'BB/Digital Banking Apps',dd:'Direct Debit',bbagent:'BB Agents',branch:'Bank Branches'};
function srcIdx(s){ s=String(s||''); var best=0, m, re=/Q\s*([1-4])\s*-?\s*FY\s*-?\s*(\d{2})/gi;
  while((m=re.exec(s))) best=Math.max(best,+m[2]*4+(+m[1]));
  /* an SBP Annual Review for FYxx is published after that year's Q4 issue */
  var a=s.match(/annual review\s*FY\s*(\d{2})/i); if(a) best=Math.max(best,+a[1]*4+4.5);
  return best; }
function mergePSR(D, P, srcLabel){
  var END={1:'Sep-',2:'Dec-',3:'Mar-',4:'Jun-'}, changed=[], skipped=[], issue=qIndexP(P.latest);
  function endOf(q){var m=q.match(/Q(\d) FY(\d+)/);var y=+m[2];return END[m[1]]+String(+m[1]<=2?y-1:y).padStart(2,'0');}
  function existingIdx(q){ var r=D.quarterly.find(function(x){return x.q===q;}), c=D.channels.find(function(x){return x.q===q;});
    return Math.max(r?srcIdx(r.src):0, c?srcIdx(c.src):0); }
  var qs={}; Object.keys(P.quarterly).concat(Object.keys(P.channels),Object.keys(P.eco)).forEach(function(q){qs[q]=1;});
  Object.keys(qs).forEach(function(q){
    if(existingIdx(q)>issue){ skipped.push(q); return; }
    if(P.quarterly[q]){ var r=D.quarterly.find(function(x){return x.q===q;}); if(!r){r={q:q,end:endOf(q),ids:null,merchants:null};D.quarterly.push(r);}
      ['p2p','bulk','p2m'].forEach(function(k){ var v=P.quarterly[q][k+'_v']; if(v==null) return;
        if(r[k+'_v']!=null&&Math.abs(r[k+'_v']-v)>0.05) changed.push(q+' Raast '+k.toUpperCase()+' volume '+r[k+'_v']+' → '+v+' Mn');
        r[k+'_v']=v; r[k+'_val']=P.quarterly[q][k+'_val']; }); r.src=srcLabel; }
    if(P.channels[q]){ var c=D.channels.find(function(x){return x.q===q;}); if(!c){c={q:q};D.channels.push(c);}
      ['atm','atm_cw','pos','ib','mb','call','ecom','ewallet','bbwallet','dd','bbagent','branch'].forEach(function(k){ var v=P.channels[q][k+'_v']; if(v==null) return;
        if(c[k+'_v']!=null&&Math.abs(c[k+'_v']-v)>0.05) changed.push(q+' '+(PSR_NAMES[k]||k)+' volume '+c[k+'_v']+' → '+v+' Mn'); });
      Object.assign(c,P.channels[q]); c.src=srcLabel; }
    if(P.eco[q]){ var e=D.eco.find(function(x){return x.q===q;}); if(!e){e={q:q};D.eco.push(e);} Object.keys(P.eco[q]).forEach(function(k){ if(P.eco[q][k]!=null) e[k]=P.eco[q][k]; }); }
  });
  [D.quarterly,D.channels,D.eco].forEach(function(a){a.sort(function(x,y){return qIndexP(x.q)-qIndexP(y.q);});});
  return {changed:changed, skipped:skipped};
}
if(typeof module!=='undefined') module.exports={psrLines:psrLines,parsePSRText:parsePSRText,mergePSR:mergePSR};
