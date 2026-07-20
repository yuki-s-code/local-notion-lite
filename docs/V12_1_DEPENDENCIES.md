# v12.1 Dependency Pinning

BlockNote was introduced in v12, but using `latest` allowed Mantine 9.x to be installed. Mantine 9 requires React 19, while this project currently uses React 18.

This version pins:

- `@blocknote/core`, `@blocknote/react`, `@blocknote/mantine` to `0.51.4`
- `@mantine/core`, `@mantine/hooks`, `@mantine/utils` to `8.3.11`

This keeps the BlockNote editor on a React 18-compatible dependency tree.
