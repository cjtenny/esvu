'use strict';

const assert = require('assert');
const fetch = require('node-fetch');
const execa = require('execa');
const Installer = require('../installer');
const { platform, unzip } = require('../common');

function getFilename() {
  switch (platform) {
    case 'darwin-x64':
    case 'darwin-arm64':
      return 'mac';
    case 'linx32':
      return 'linux-i686';
    case 'linux-x64':
      return 'linux-x86_64';
    case 'win32-ia32':
      return 'win32';
    case 'win32-x64':
      return 'win64';
    default:
      throw new Error(`No SpiderMonkey builds available for ${platform}`);
  }
}

class SpiderMonkeyInstaller extends Installer {
  constructor(...args) {
    super(...args);

    this.binPath = undefined;
  }

  static async resolveVersion(version) {
    if (version === 'latest') {
      // Build a request for buildhub2: https://buildhub2.readthedocs.io/en/latest/project.html
      const body = {
        size: 1,
        sort: { 'build.id': 'desc' },
        query: {
          bool: {
            must: [
              { term: { 'source.product': 'firefox' } },
              { term: { 'source.tree': 'mozilla-central' } },
              { term: { 'target.channel': 'nightly' } },
              { term: { 'target.platform': 'win64' } }, // Set 'win64' because buildhub only lists win* builds
            ],
          },
        },
      };

      const data = await fetch('https://buildhub.moz.tools/api/search', {
        method: 'post',
        body: JSON.stringify(body),
      }).then((r) => r.json());

      const source = data.hits.hits[0]._source;

      return `${source.target.version}#${source.build.id}`;
    }
    return version;
  }

  getDownloadURL(version) {
    const match = /#(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(version);
    if (match) {
      const year = match[1];
      const month = match[2];
      const date = match.slice(1).join('-');
      return `https://archive.mozilla.org/pub/firefox/nightly/${year}/${month}/${date}-mozilla-central/jsshell-${getFilename()}.zip`;
    }
    return `https://archive.mozilla.org/pub/firefox/releases/${version}/jsshell/jsshell-${getFilename()}.zip`;
  }

  extract() {
    return unzip(this.downloadPath, this.extractedPath);
  }

  async install() {
    switch (platform) {
      case 'darwin-x64':
      case 'darwin-arm64':
        await this.registerAssets('*.dylib');
        await this.registerBinary('js', 'sm');
        this.binPath = await this.registerBinary('js', 'spidermonkey');
        break;
      case 'linux-ia32':
      case 'linux-x64': {
        await this.registerAssets('*.so');
        const sm = await this.registerAsset('js');
        const source = `LD_LIBRARY_PATH="${this.installPath}" "${sm}"`;
        this.binPath = await this.registerScript('spidermonkey', source);
        await this.registerScript('sm', source);
        break;
      }
      case 'win32-ia32':
      case 'win32-x64': {
        await this.registerAssets('*.dll');
        const sm = await this.registerAsset('js.exe');
        this.binPath = await this.registerScript('spidermonkey', `"${sm}"`);
        await this.registerScript('sm', `"${sm}"`);
        break;
      }
      default:
        throw new RangeError(`Unknown platform ${platform}`);
    }
  }

  async test() {
    const program = 'print("42");';
    const output = '42';

    assert.strictEqual(
      (await execa(this.binPath, ['-e', program])).stdout,
      output,
    );
  }
}

SpiderMonkeyInstaller.config = {
  name: 'SpiderMonkey',
  id: 'jsshell',
  supported: [
    'linux-ia32', 'linux-x64',
    'win32-ia32', 'win32-x64',
    'darwin-x64', 'darwin-arm64',
  ],
};

module.exports = SpiderMonkeyInstaller;
