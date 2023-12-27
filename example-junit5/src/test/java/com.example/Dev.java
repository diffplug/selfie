package com.example;

import io.jooby.Jooby;
import io.jooby.SneakyThrows;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;

public class Dev extends Jooby {
  {
    getServices().put(SecureRandom.class, repeatableRandom());
    getServices().put(Time.class, new DevTime());
  }

  private static SecureRandom repeatableRandom() {
    try {
      SecureRandom random = SecureRandom.getInstance("SHA1PRNG");
      random.setSeed(new byte[1]);
      return random;
    } catch (NoSuchAlgorithmException e) {
      throw SneakyThrows.propagate(e);
    }
  }
}
