import assert from "node:assert/strict";
import { test } from "node:test";
import { browserPartition, browserUrl, parseBrowserCommand } from "../shared/browser.ts";

test("browser IPC validates untyped commands and does not allow privileged navigation", () => {
	for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "devtools://inspect"]) assert.throws(() => browserUrl(url));
	assert.equal(browserUrl("localhost:3000"), "https://localhost:3000/");
	assert.equal(browserUrl("about:blank"), "about:blank");
	for (const command of [null, {}, {type:"close"}, {type:"open",url:"https://example.com",sessionId:5}, {type:"zoom",id:"tab",factor:NaN}, {type:"zoom",id:"tab",factor:4}, {type:"viewport",id:"tab",viewport:{width:400.5,height:800}}]) assert.throws(() => parseBrowserCommand(command));
	assert.deepEqual(parseBrowserCommand({type:"viewport",id:"tab",viewport:{width:390,height:844}}), {type:"viewport",id:"tab",viewport:{width:390,height:844}});
});

test("browserPartition assigns scoped persistent partition per session", () => {
	assert.equal(browserPartition("session-abc"), "persist:ly-browser-session-abc");
	assert.equal(browserPartition(""), "persist:ly-browser-global");
	assert.equal(browserPartition(null), "persist:ly-browser-global");
});
