import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { dts } from 'rollup-plugin-dts';

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/cjs/index.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/es/index.js',
        format: 'es',
        sourcemap: true,
      }
    ],
    plugins: [typescript(), nodeResolve(), commonjs()],
  },
  {
    input: 'src/types.d.ts',
    output: [{ file: 'types/index.d.ts', format: 'es' }],
    plugins: [dts()],
  },
];