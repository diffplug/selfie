package com.example;

import java.time.Clock;
import java.time.LocalDateTime;

public interface Time {
  /** DateTime in UTC. */
  LocalDateTime now();

  class Realtime implements Time {
    @Override
    public LocalDateTime now() {
      return LocalDateTime.now(Clock.systemUTC());
    }
  }
}
