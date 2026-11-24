package com.kaleox.deliveryya.config;

import org.springframework.beans.factory.DisposableBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * Dedicated executor for notification delivery (in-app rows, FCM, e-mail, SMS).
 *
 * <p>Deliberately <b>not</b> a {@code TaskExecutor} / {@code Executor} bean: Spring Boot
 * auto-configures {@code applicationTaskExecutor} only when no other {@code Executor} bean
 * exists, so exposing a plain {@code ThreadPoolTaskExecutor} would silently replace it and also
 * make by-type injection ambiguous. {@link NotificationExecutor} wraps the pool instead, which
 * keeps it isolated from everything else.</p>
 *
 * <p>Bounded queue with a caller-runs policy: when the pool is saturated the submitting thread
 * does the work rather than losing the notification.</p>
 */
@Configuration
public class NotificationAsyncConfig {

    public static final String NOTIFICATION_TASK_EXECUTOR = "notificationTaskExecutor";

    @Bean(name = NOTIFICATION_TASK_EXECUTOR)
    public NotificationExecutor notificationTaskExecutor() {
        return new NotificationExecutor();
    }

    /** Thin wrapper around the notification thread pool. */
    public static class NotificationExecutor implements DisposableBean {

        private final ThreadPoolTaskExecutor executor;

        public NotificationExecutor() {
            ThreadPoolTaskExecutor pool = new ThreadPoolTaskExecutor();
            pool.setCorePoolSize(2);
            pool.setMaxPoolSize(8);
            pool.setQueueCapacity(500);
            pool.setKeepAliveSeconds(60);
            pool.setThreadNamePrefix("notification-");
            pool.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
            pool.setWaitForTasksToCompleteOnShutdown(true);
            pool.setAwaitTerminationSeconds(30);
            pool.initialize();
            this.executor = pool;
        }

        public void execute(Runnable task) {
            executor.execute(task);
        }

        @Override
        public void destroy() {
            executor.shutdown();
        }
    }
}
