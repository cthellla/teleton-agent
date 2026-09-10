// package.json
var package_default = {
  name: "@teleton-agent/sdk",
  version: "2.1.0",
  description: "Plugin SDK for Teleton Agent \u2014 typed capabilities, runtime contracts, and error helpers",
  type: "module",
  main: "dist/index.js",
  types: "dist/index.d.ts",
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    }
  },
  files: [
    "dist/"
  ],
  scripts: {
    build: "tsup",
    typecheck: "tsc --noEmit",
    prepublishOnly: "npm run build"
  },
  keywords: [
    "teleton",
    "telegram",
    "ton",
    "plugin",
    "sdk",
    "types"
  ],
  author: "ZKProof",
  license: "MIT",
  sideEffects: false,
  engines: {
    node: ">=20"
  },
  repository: {
    type: "git",
    url: "https://github.com/TONresistor/teleton-agent",
    directory: "packages/sdk"
  },
  dependencies: {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.0.0"
  },
  devDependencies: {
    "@ton/core": "^0.63.1",
    "better-sqlite3": "^12.0.0",
    tsup: "^8.5.0",
    typescript: "^5.8.0"
  },
  peerDependencies: {
    "@ton/core": ">=0.63.0 <1.0.0",
    "better-sqlite3": ">=9.0.0"
  },
  peerDependenciesMeta: {
    "better-sqlite3": {
      optional: true
    }
  }
};

// src/types/plugin.ts
var PLUGIN_HOOK_NAMES = [
  "tool:before",
  "tool:after",
  "tool:error",
  "prompt:before",
  "prompt:after",
  "session:start",
  "session:end",
  "message:receive",
  "response:before",
  "response:after",
  "response:error",
  "agent:start",
  "agent:stop"
];
var TOOL_SCOPES = [
  "open",
  "always",
  "dm-only",
  "group-only",
  "admin-only",
  "allowlist",
  "disabled"
];
var TOOL_CATEGORIES = ["data-bearing", "action"];

// src/errors.ts
var PluginSDKError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
  code;
  name = "PluginSDKError";
};

// src/index.ts
var SDK_VERSION = package_default.version;
export {
  PLUGIN_HOOK_NAMES,
  PluginSDKError,
  SDK_VERSION,
  TOOL_CATEGORIES,
  TOOL_SCOPES
};
