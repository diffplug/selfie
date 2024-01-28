package com.example;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

public class DevTime implements Time {
  private LocalDateTime now = LocalDateTime.of(2000, 1, 1, 0, 0);

  public void setYear(int year) {
    now = LocalDateTime.of(year, 1, 1, 0, 0);
  }

  public void advance24hrs() {
    now = now.plus(24, ChronoUnit.HOURS);
  }

  @Override
  public LocalDateTime now() {
    return now;
  }
}
