import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.mitsuo.lowkey',
  appName: "Mitsuo's Corner",
  webDir: 'outputs',
  bundledWebRuntime: false,
  ios: {
    contentInset: 'automatic'
  }
};

export default config;

