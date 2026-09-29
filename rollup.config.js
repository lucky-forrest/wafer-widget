import sourcemaps from 'rollup-plugin-sourcemaps';
import babel from '@rollup/plugin-babel';
import typescript from 'rollup-plugin-typescript2';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';
import json from '@rollup/plugin-json';

export default {
  input: 'src/index.ts',
  output: {
    exports: 'auto',
    file: 'lib/wafer-widget.min.js',
    format: 'umd',
    name: 'WaferWidget',
    sourcemap: true,
  },
  plugins: [
    sourcemaps(),
    typescript(),
    resolve(),  // 解析 node_modules 中的模块
    commonjs(),
    babel({ babelHelpers: 'bundled' }),
    terser(),
    json(),
  ],
  watch: {
    exclude: 'node_modules/**'
  }
};
