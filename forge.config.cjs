module.exports = {
  packagerConfig: {
    name: "Business OS",
    appBundleId: "com.businessos.desktop",
    asar: false,
    protocols: [{ name: "Business OS", schemes: ["business-os"] }],
    ignore: [
      /^\/(apps|packages|tests|migrations|infra|docs|scripts)(\/|$)/,
      /^\/\.env/,
      /^\/\.git(\/|$)/,
      /^\/out(\/|$)/,
      /^\/(test-results|playwright-report)(\/|$)/,
      /^\/dist\/server(\/|$)/,
    ],
  },
  makers: [{ name: "@electron-forge/maker-zip", platforms: ["darwin"] }],
};
