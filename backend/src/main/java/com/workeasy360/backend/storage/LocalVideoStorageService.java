package com.workeasy360.backend.storage;

import com.workeasy360.backend.domain.Ids;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/** Local-disk implementation for zero-install development. Not secure delivery on its own — access control
 *  and short-lived tokens are enforced by VideoController before any byte is streamed. */
@Service
public class LocalVideoStorageService implements VideoStorageService {
    private final Path root;

    public LocalVideoStorageService(@Value("${app.storage.root}") String rootPath) {
        this.root = Path.of(rootPath).toAbsolutePath().normalize();
    }

    @Override
    public String store(InputStream in, String subdir, String suggestedFileName) throws Exception {
        String ext = "";
        int dot = suggestedFileName == null ? -1 : suggestedFileName.lastIndexOf('.');
        if (dot >= 0) ext = suggestedFileName.substring(dot).toLowerCase().replaceAll("[^a-z0-9.]", "");
        String key = subdir + "/" + Ids.next("f") + ext;
        Path dest = resolve(key);
        Files.createDirectories(dest.getParent());
        Files.copy(in, dest, StandardCopyOption.REPLACE_EXISTING);
        return key;
    }

    @Override
    public Path resolve(String storageKey) {
        Path p = root.resolve(storageKey).normalize();
        if (!p.startsWith(root)) throw new SecurityException("Invalid storage key");
        return p;
    }

    @Override
    public boolean exists(String storageKey) { return storageKey != null && Files.exists(resolve(storageKey)); }

    @Override
    public void delete(String storageKey) {
        try { if (storageKey != null) Files.deleteIfExists(resolve(storageKey)); } catch (Exception ignored) {}
    }
}
