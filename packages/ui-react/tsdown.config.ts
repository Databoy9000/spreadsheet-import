import { defineConfig } from "tsdown";
import { reactCompiler } from "../../tools/react-compiler.ts";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  exports: {
    customExports: { "./src/*": "./src/*" },
  },
  clean: true,
  external: ["react", "react/jsx-runtime", "react/compiler-runtime"],
  plugins: [reactCompiler()],
});
