// electron-builder afterPack hook: on Windows, put the KLABYTV icon and name into KLABYTV.exe.
// electron-builder would do this with rcedit, which needs Wine when building on Linux/macOS;
// resedit edits the exe's resources in plain JavaScript instead.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { productFilename } = context.packager.appInfo;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const [major, minor, patch] = version.split(/[.-]/).map(Number); // 1.0.0-alpha -> 1, 0, 0
    vi.setFileVersion(major, minor, patch, 0, lang);
    vi.setProductVersion(major, minor, patch, 0, lang);
    for (const l of vi.getAllLanguagesForStringValues()) {
      vi.setStringValues(l, {
        ProductName: productFilename,
        FileDescription: productFilename,
        CompanyName: productFilename,
        InternalName: productFilename,
        OriginalFilename: `${productFilename}.exe`,
        LegalCopyright: `© ${new Date().getFullYear()} ${productFilename}`,
        FileVersion: version,
        ProductVersion: version,
      });
    }
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
};
