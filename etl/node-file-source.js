const fs = require('fs');

// pmtiles.Source adapter backed by a local file, for Node (the package's
// FileSource expects a browser File object with .slice().arrayBuffer()).
class NodeFileSource {
  constructor(path) {
    this.path = path;
    this.fd = fs.openSync(path, 'r');
  }
  getKey() {
    return this.path;
  }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    fs.readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
}

module.exports = { NodeFileSource };
