package tv.klabytv.core;

import org.json.JSONObject;

import java.util.Collections;
import java.util.Map;

/** Where the content comes from: an Xtream Codes server or an M3U playlist. Answers are Xtream-shaped JSON. */
public interface Provider {
    /** Raw JSON text of the answer to an Xtream API action. */
    String call(String action, JSONObject params) throws Exception;

    JSONObject login() throws Exception;

    /** kind: live | movie | series */
    String streamUrl(String kind, String id, String ext) throws Exception;

    /** Extra request headers for this stream (M3U #EXTVLCOPT user agent / referrer). */
    default Map<String, String> headersFor(String kind, String id) throws Exception {
        return Collections.emptyMap();
    }
}
