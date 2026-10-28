// Small JSON file store kept in the app's userData folder.
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.data = defaults;
    try {
      this.data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch { /* first run or corrupt file: start from defaults */ }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonStore };
