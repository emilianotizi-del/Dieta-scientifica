// test.js — regressione Rotta 80 (node test.js; richiede jsdom)
const {JSDOM}=require('jsdom');
const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'dangerously',url:'https://example.com'});
dom.window.addEventListener('error',e=>{console.log('ERRORE RUNTIME:',e.message);process.exit(1);});
setTimeout(()=>{
  const w=dom.window;
  const out=w.eval(`(function(){
    U.vegDays=2; U.mealsPref="auto"; U.esclusioni=["fegato","finocchio"]; U.menuCache={}; save();
    const NONVEG=/pollo|manzo|tonno|salmone|orata|branzino|prosciutt|bresaola|vitell|merluzz|alic[ei]|maiale|tacchin|pesce|carne|rag[uù]|salume|polpo|gamber|vongol|cozze|sgombro|nasello|sogliola|salsicc|speck|guancial|pancetta/i;
    let r={giorni:14,veg:0,vegViol:0,esclViol:0,stagViol:0,capViol:0,fasceViol:0,fruttaViol:0,eggDouble:0,sameDayDup:0,kcalOff:[],det:true};
    const m1=JSON.stringify(genMenu(todayKey(),true).meals.map(x=>x.items.map(i=>i.name)));
    U.menuCache={};
    const m2=JSON.stringify(genMenu(todayKey(),true).meals.map(x=>x.items.map(i=>i.name)));
    r.det=(m1===m2);
    for(let d=0;d<14;d++){
      const k=todayKey(new Date(Date.now()+d*864e5));
      const m=genMenu(k); const veg=isVegDay(k); if(veg) r.veg++;
      const month=dateFromKey(k).getMonth()+1;
      const seen={}; let fruit=0, whole=0;
      m.meals.forEach(me=>{
        let eggsMeal=0;
        me.items.forEach(i=>{
          const f=i.id!=null?FOOD_DB[i.id]:null;
          if(veg&&NONVEG.test(i.name)) r.vegViol++;
          if(/fegato|finocchi/i.test(i.name)) r.esclViol++;
          if(f&&Array.isArray(f[6])&&!f[6].includes(month)) r.stagViol++;
          if(f&&i.g>capOf(f)) r.capViol++;
          if(f&&f[7]==="fr"){ fruit++; }
          if(/^uov(o|a)\\b|frittata/i.test(i.name)){ eggsMeal++; if(!/albume/i.test(i.name)) whole++; }
          if(!/olio|parmigiano|grana|succo di limone|aceto/i.test(i.name)){ seen[i.name]=(seen[i.name]||0)+1; }
        });
        if(eggsMeal>1) r.eggDouble++;
      });
      if(whole>1) r.eggDouble++;
      if(fruit>2) r.fruttaViol++;
      r.sameDayDup+=Object.values(seen).filter(n=>n>1).length;
      const tot=m.meals.reduce((s,me)=>s+me.items.reduce((a,i)=>a+i.kcal,0),0);
      const off=Math.abs(tot-m.target.kcal)/m.target.kcal;
      if(off>0.10) r.kcalOff.push(k+" "+Math.round(off*100)+"%");
      /* presidio proteico INFORMATIVO (finding v2.39: media ~83%, minimi ~65% del target giornaliero).
         Diventerà bloccante quando il comitato fisserà target e banda, col motore v3. */
      const pr=m.meals.reduce((s,me)=>s+me.items.reduce((a,i)=>a+i.p,0),0);
      r.protRatios=r.protRatios||[]; r.protRatios.push(pr/m.target.p);
    }
    /* lista spesa 2.0: max 2 pani semplici, basici spuntabili */
    buildSpesa();
    const sHtml=document.getElementById('spesaList').innerHTML;
    r.spesaPani=(sHtml.match(/data-spesa="Pane[^"]*"/gi)||[]).filter(s=>!/marmellata|ricotta|burro|miele|olio/i.test(s)).length;
    r.spesaBasici=[...document.querySelectorAll('#spesaList [data-spesa]')].filter(cb=>cb.dataset.spesa.startsWith('\u{1F9C2}')).length;
    return JSON.stringify(r);
  })()`);
  const r=JSON.parse(out);
  console.log('deterministico:',r.det);
  console.log('giorni veg su 14:',r.veg,'| violazioni veg:',r.vegViol);
  console.log('violazioni esclusioni:',r.esclViol,'| stagionalità:',r.stagViol,'| limiti porzione:',r.capViol);
  console.log('doppie uova:',r.eggDouble,'| doppioni stesso giorno:',r.sameDayDup,'| giorni >2 frutti:',r.fruttaViol);
  console.log('giorni oltre ±10% kcal:',r.kcalOff.length,r.kcalOff.slice(0,3).join(' · '));
  const pAvg=r.protRatios.reduce((a,b)=>a+b,0)/r.protRatios.length, pMin=Math.min(...r.protRatios);
  console.log('proteine vs target giornaliero (informativo): media '+Math.round(pAvg*100)+'% | minimo '+Math.round(pMin*100)+'% — presidio dal motore v3');
  console.log('spesa: pani semplici in lista:',r.spesaPani,'(max 2) | basici spuntabili:',r.spesaBasici);
  const fail=!r.det||r.vegViol||r.esclViol||r.stagViol||r.capViol||r.eggDouble||r.spesaPani>2||!r.spesaBasici;
  console.log(fail?'❌ REGRESSIONE':'✅ tutto verde');
  process.exit(fail?1:0);
},700);
