import { createRequire } from "node:module"; import os from "node:os"; import path from "node:path"; import fs from "node:fs";
import { spawn } from "node:child_process";
const require = createRequire(path.join(os.homedir(), ".claude/skills/gstack/__r__.js"));
const { chromium } = require("playwright");
const APP = path.join(os.homedir(), ".claude/skills/archify/editor");
const PORT = 8656, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn("python3", ["-m","http.server",String(PORT),"--bind","127.0.0.1"], {cwd:APP, stdio:"ignore"});
for (let i=0;i<60;i++){ try{ if((await fetch(BASE+"/index.html")).ok) break; }catch{} await new Promise(r=>setTimeout(r,200)); }
let pass=0, fail=0; const ck=(n,c,x)=>{ c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(x?"  — "+x:""))); };
const b = await chromium.launch(); const page = await b.newPage({viewport:{width:1600,height:1000}});
const src = ()=>page.evaluate(()=>window.__archTest.getSource());
const depth = ()=>page.evaluate(()=>window.__archTest.undoDepth());
try{
  await page.goto(BASE+"/index.html"); await page.waitForFunction(()=>window.__archTest&&window.__archTest.ready,{timeout:20000});
  const html = fs.readFileSync(path.join(APP,"demo_svg_slide.html"),"utf8");
  await page.evaluate(async h=>{ await window.__archTest.load(h,"svg.html"); }, html);
  await page.waitForFunction(()=>window.__archTest.ready===true,{timeout:20000});
  const frame = ()=>page.frameLocator("#diagram-frame");
  const A0 = await src();

  // ---- U1: SVG box fill edit → Cmd+Z restores byte-identically
  await page.evaluate(()=>window.__archTest.setMode("edit"));
  await frame().locator('[data-arch-eid="svgbox:2"]').click();
  await page.waitForFunction(()=>{const s=window.__archTest.getSelected();return s&&s.eid==="svgbox:2";},null,{timeout:5000});
  await page.evaluate(()=>window.__archTest.fmtFill("#3b82f6"));   // ★ 팝업 폐지(2026-07-21) → 툴바 채움
  await page.waitForFunction(()=>window.__archTest.undoDepth()===1,null,{timeout:6000});
  const edited = await src();
  ck("U1a 편집이 실제로 소스를 바꿈", edited !== A0);
  ck("U1b undo 스택에 쌓임", (await depth())===1);
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);   // 패널/입력 포커스 해제
  await page.keyboard.press("Meta+z");
  await page.waitForFunction(()=>window.__archTest.undoDepth()===0,null,{timeout:6000}).catch(()=>{});
  ck("U1c Cmd+Z로 바이트 동일 복원", (await src())===A0, "depth="+(await depth()));

  // ---- U2: Ctrl+Z (non-mac) also undoes
  await frame().locator('[data-arch-eid="svgbox:3"]').click();
  await page.waitForFunction(()=>{const s=window.__archTest.getSelected();return s&&s.eid==="svgbox:3";},null,{timeout:5000});
  await page.evaluate(()=>window.__archTest.fmtFill("#c0392b"));   // ★ 팝업 폐지 → 툴바 채움
  await page.waitForFunction(()=>window.__archTest.undoDepth()===1,null,{timeout:6000});
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  await page.keyboard.press("Control+z");
  await page.waitForFunction(()=>window.__archTest.undoDepth()===0,null,{timeout:6000}).catch(()=>{});
  ck("U2 Ctrl+Z도 되돌림", (await src())===A0, "depth="+(await depth()));

  // ---- U3: free-standing text edit → Cmd+Z (class-c svgtext unit)
  //   NOTE: iframe contentDocument는 null(샌드박스) — frameLocator로만 접근 가능.
  const tLoc = frame().locator('[data-arch-eid^="svgtext:"]').first();
  await tLoc.waitFor({timeout:8000});
  const tEid = await tLoc.getAttribute("data-arch-eid");
  await tLoc.click({force:true});
  await page.waitForFunction((e)=>{const s=window.__archTest.getSelected();return s&&s.eid===e;},tEid,{timeout:5000}).catch(()=>{});
  // ★ 팝업 폐지 → 자유 텍스트 편집은 인라인 커밋 훅(applyInlineCommit)으로. 실제 UX는 요소 편집 OFF 단일클릭.
  const applied = await page.evaluate((e)=>{ window.__archTest.applyInlineCommit(e,"svgtext",null,"변경된 라벨"); return true; }, tEid);
  await page.waitForFunction(()=>window.__archTest.undoDepth()>=1,null,{timeout:6000}).catch(()=>{});
  const d1=await depth();
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  await page.keyboard.press("Meta+z"); await page.waitForTimeout(800);
  ck("U3 자유 텍스트("+tEid+") 편집도 Cmd+Z로 복원", applied && d1>=1 && (await src())===A0, `applied=${applied} depth ${d1}->${await depth()}`);

  // ---- U4: focus in an input → we yield to the browser (diagram NOT undone)
  await frame().locator('[data-arch-eid="svgbox:4"]').click();
  await page.waitForFunction(()=>{const s=window.__archTest.getSelected();return s&&s.eid==="svgbox:4";},null,{timeout:5000});
  await page.evaluate(()=>window.__archTest.fmtFill("#0b8a5a"));   // ★ 팝업 폐지 → 툴바 채움
  await page.waitForFunction(()=>window.__archTest.undoDepth()===1,null,{timeout:6000});
  const e3=await src(), d3=await depth();
  // ★ 팝업 폐지 → 툴바 입력에 포커스(inField 양보 규칙 검증). D26: 텍스트 컨트롤(#fmt-textcolor)은
  //   도형만 선택한 상태(인라인 세션 없음)에선 비활성이라 포커스 불가 → 이 상태에서 활성인 도형
  //   컨트롤 입력(#fmt-fill 채움색)에 포커스한다. "입력창 포커스 = 브라우저 undo 양보" 규칙은 동일.
  await page.focus("#fmt-fill").catch(()=>{});
  await page.keyboard.press("Meta+z"); await page.waitForTimeout(500);
  ck("U4 입력창 포커스 중엔 다이어그램 undo 안 함(브라우저에 양보)", (await depth())===d3 && (await src())===e3, `depth ${d3}->${await depth()}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  await page.keyboard.press("Meta+z"); await page.waitForTimeout(600);
  ck("U4b 필드 밖에서는 정상 되돌림", (await src())===A0);

  // ---- U5: empty stack spam → no crash
  for(let i=0;i<6;i++){ await page.keyboard.press("Meta+z"); await page.waitForTimeout(120); }
  ck("U5 빈 스택 연타 크래시 없음", await page.evaluate(()=>!!(window.__archTest&&window.__archTest.ready)) && (await src())===A0);
}catch(err){ fail++; console.log("FAIL (예외) "+(err&&err.stack?err.stack.split("\n").slice(0,3).join("\n"):err)); }
finally{ await b.close(); srv.kill(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
