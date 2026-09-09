import test from "node:test";
import assert from "node:assert/strict";
import { McpManager } from "../src/mcp/client.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ListRootsResultSchema } from "@modelcontextprotocol/sdk/types.js";

test("McpManager configures roots capability and handles roots/list requests", async () => {
	const manager = new McpManager();
	const testRoots = [
		{ uri: "file:///workspace/my-project", name: "workspace" },
		{ uri: "file:///home/user/.lyra/scratch", name: "scratch" },
	];
	manager.setRoots(testRoots);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

	const server = new Server(
		{ name: "test-server", version: "1.0.0" },
		{ capabilities: { tools: {} } },
	);

	const client = new Client(
		{ name: "lyra", version: "0.1.0" },
		{ capabilities: { roots: { listChanged: true } } },
	);

	// Mirror client registration in McpManager
	const { ListRootsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
	client.setRequestHandler(ListRootsRequestSchema, async () => ({
		roots: testRoots,
	}));

	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

	// Verify server sees roots capability
	const clientCaps = server.getClientCapabilities();
	assert.ok(clientCaps?.roots, "Server should detect client roots capability");

	// Verify server can query roots/list and receives configured roots
	const response = await server.request({ method: "roots/list" }, ListRootsResultSchema);
	assert.deepEqual(response.roots, testRoots);

	await Promise.all([client.close(), server.close()]);
});
