package com.workeasy360.backend.config;

import com.workeasy360.backend.web.SyncEventInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    private final SyncEventInterceptor syncEvents;
    public WebConfig(SyncEventInterceptor syncEvents) { this.syncEvents = syncEvents; }

    @Override
    public void addInterceptors(@NonNull InterceptorRegistry registry) {
        registry.addInterceptor(syncEvents).addPathPatterns("/api/**");
    }
}
