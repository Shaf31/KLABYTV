package tv.klabytv.core;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/** Small JSON file store in the app's private folder (same files as the desktop app). */
public class JsonStore {
    private final File file;
    public JSONObject data;

    public JsonStore(File file, JSONObject defaults) {
        this.file = file;
        this.data = defaults;
        try {
            byte[] raw;
            try (FileInputStream in = new FileInputStream(file)) {
                raw = XtreamClient.readAll(in);
            }
            JSONObject saved = new JSONObject(new String(raw, StandardCharsets.UTF_8));
            for (Iterator<String> it = saved.keys(); it.hasNext(); ) {
                String k = it.next();
                data.put(k, saved.get(k));
            }
        } catch (Exception ignored) {
            // first run or corrupt file: start from defaults
        }
    }

    public synchronized void save() {
        try {
            File dir = file.getParentFile();
            if (dir != null) dir.mkdirs();
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(data.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (!tmp.renameTo(file)) {
                file.delete();
                if (!tmp.renameTo(file)) throw new java.io.IOException("rename failed");
            }
        } catch (Exception e) {
            System.err.println("save failed " + file + ": " + e);
        }
    }
}
