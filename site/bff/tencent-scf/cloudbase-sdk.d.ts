declare module '@cloudbase/node-sdk' {
  const cloudbase: {
    init(options: { env: string; accessKey: string }): {
      database(): unknown;
    };
  };
  export default cloudbase;
}
