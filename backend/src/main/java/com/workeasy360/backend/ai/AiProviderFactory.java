package com.workeasy360.backend.ai;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Picks the provider from configuration. AI disabled → mock, always (tests and local use never hit the network). */
@Configuration
@EnableConfigurationProperties(AiProperties.class)
public class AiProviderFactory {
    @Bean
    public AiProvider aiProvider(AiProperties props) {
        if (props.usesMock()) return new MockAiProvider();
        return switch (props.getProvider()) {
            case "openai" -> new HttpAiProviders.OpenAiCompatible(props);
            case "anthropic" -> new HttpAiProviders.Anthropic(props);
            default -> throw new IllegalStateException("Unknown AI_PROVIDER '" + props.getProvider() + "' (supported: mock, openai, anthropic)");
        };
    }
}
