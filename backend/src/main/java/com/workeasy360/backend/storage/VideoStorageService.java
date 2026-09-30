package com.workeasy360.backend.storage;

import java.io.InputStream;
import java.nio.file.Path;

/**
 * Storage abstraction for video (and thumbnail) bytes. `LocalVideoStorageService` is the zero-install dev
 * implementation (plain files on disk under app.storage.root). Swap in an S3 / Azure Blob / GCS implementation
 * for production by implementing this interface and changing the @Service that gets wired — nothing in
 * VideoService, the controller, or the Course Builder needs to change.
 */
public interface VideoStorageService {
    String store(InputStream in, String subdir, String suggestedFileName) throws Exception;
    Path resolve(String storageKey);
    boolean exists(String storageKey);
    void delete(String storageKey);
}
