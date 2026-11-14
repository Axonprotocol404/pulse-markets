import { Buffer } from "buffer";

// Required by @solana/web3.js in the browser; must run before App imports.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
