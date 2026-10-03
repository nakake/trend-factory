#!/usr/bin/env bash
set -u
script="$(dirname "$0")/check-pr-scope.sh"
failed=0

expect() {
  local want=$1 name=$2 input=$3 got
  printf '%b' "$input" | bash "$script" >/dev/null 2>&1
  got=$?
  if { [ "$want" = pass ] && [ "$got" -eq 0 ]; } || { [ "$want" = fail ] && [ "$got" -ne 0 ]; }; then
    echo "ok   $name"
  else
    echo "FAIL $name (want $want, exit $got)"
    failed=1
  fi
}

expect pass 'one directory'            'tools/foo-bar/index.html\ntools/foo-bar/app.js\ntools/foo-bar/img/a.png\n'
expect fail 'two directories'          'tools/foo-bar/index.html\ntools/baz-qux/index.html\n'
expect fail 'outside tools'            'docs/design.md\n'
expect fail 'tools and outside'        'tools/foo-bar/index.html\n.github/CODEOWNERS\n'
expect fail 'package.json'             'tools/foo-bar/index.html\ntools/foo-bar/package.json\n'
expect fail 'wrangler.toml'            'tools/foo-bar/wrangler.toml\n'
expect fail 'wrangler.jsonc'           'tools/foo-bar/wrangler.jsonc\n'
expect fail 'ts file'                  'tools/foo-bar/main.ts\n'
expect fail 'cloudflare.config.ts'     'tools/foo-bar/cloudflare.config.ts\n'
expect fail 'template change'          'tools/_template/index.html\n'
expect fail 'bad slug uppercase'       'tools/Foo/index.html\n'
expect fail 'bad slug too short'       'tools/a/index.html\n'
expect fail 'bad slug leading hyphen'  'tools/-foo/index.html\n'
expect fail 'disallowed extension'     'tools/foo-bar/run.sh\n'
expect fail 'file directly in tools'   'tools/foo.html\n'
expect pass 'empty diff'               ''

exit "$failed"
