import babel from "@rolldown/plugin-babel";
import reactCompilerPlugin from "babel-plugin-react-compiler";

/**
 * React Compiler, as a Rolldown/Vite plugin. The packages ship compiled output
 * and leave memoization to it, so the builds, the tests and the playground all
 * run through this one setup.
 *
 * `panicThreshold: "all_errors"` turns a component the compiler skips into a
 * build error. Skipped code silently loses its memoization, so it should fail
 * loudly rather than ship unmemoized.
 */
export function reactCompiler(include: RegExp = /\/src\/.*\.tsx?$/) {
  return babel({
    include,
    plugins: [[reactCompilerPlugin, { target: "19", panicThreshold: "all_errors" }]],
  });
}
