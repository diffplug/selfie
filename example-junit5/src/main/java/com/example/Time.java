package com.example;

import java.time.LocalDateTime;

public interface Time {
  /** DateTime in UTC. */
  LocalDateTime now();
}
