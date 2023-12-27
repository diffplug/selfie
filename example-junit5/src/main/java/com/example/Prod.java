package com.example;

import io.jooby.Jooby;
import io.jooby.SneakyThrows;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDateTime;

public class Prod extends Jooby {
  {
    getServices().put(SecureRandom.class, secureRandom());
    getServices().put(Time.class, () -> LocalDateTime.now(Clock.systemUTC()));
  }

  static SecureRandom secureRandom() {
    try {
      SecureRandom nativeRandom = SecureRandom.getInstanceStrong();
      byte[] seed = nativeRandom.generateSeed(55);
      SecureRandom pureJava = SecureRandom.getInstance("SHA1PRNG");
      pureJava.setSeed(seed);
      return pureJava;
    } catch (NoSuchAlgorithmException e) {
      throw SneakyThrows.propagate(e);
    }
  }
}
