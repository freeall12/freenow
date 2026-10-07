'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Development acceptance only. Reuse must name a private temporary profile we
// created, never an arbitrary userData directory or the user's real desktop.
function externalAgentQaOptions(args, temporaryDirectory) {
  const read = prefix => {const values = args.filter(arg => arg.startsWith(prefix)); if (values.length > 1) throw Error('Invalid external Agent QA options'); return values[0]?.slice(prefix.length);};
  const requested = read('--freenow-external-agent-qa-profile='), project = read('--freenow-external-agent-qa-project=');
  const temporaryRoot = fs.realpathSync(temporaryDirectory);
  let directory;
  if (requested) {
    directory = path.resolve(requested); const stat = fs.lstatSync(directory);
    if (!path.isAbsolute(requested) || fs.realpathSync(directory) !== directory || path.dirname(directory) !== temporaryRoot || !/^freenow-desktop-qa-[A-Za-z0-9]{6}$/.test(path.basename(directory)) || !stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw Error('Invalid external Agent QA profile');
  } else directory = fs.realpathSync(fs.mkdtempSync(path.join(temporaryRoot, 'freenow-desktop-qa-')));
  if (project !== undefined && !/^[A-Za-z0-9_-]{1,100}$/.test(project)) throw Error('Invalid external Agent QA project');
  return {directory, project};
}
module.exports = {externalAgentQaOptions};
