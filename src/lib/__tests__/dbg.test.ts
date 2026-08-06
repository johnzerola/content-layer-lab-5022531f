import { it } from "vitest";
import { fixtures } from "@/lib/__tests__/fixtures";
import { detectFromFrames } from "@/lib/detect-core";
it("dbg", () => {
  for (const f of fixtures()) {
    const r = detectFromFrames(f.set);
    console.log(f.name, JSON.stringify(r.map(x=>({x:x.x,y:x.y,w:x.w,h:x.h,l:x.label}))));
  }
});
