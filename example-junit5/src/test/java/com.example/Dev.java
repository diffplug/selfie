package com.example;

import io.jooby.Jooby;
import io.jooby.SneakyThrows;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;

public class Dev extends Jooby {
  public static Dev realtime(boolean realtime) {
    return new Dev(realtime);
  }

  public Dev() {
    this(false);
  }

  private Dev(boolean realtime) {
    getServices().put(SecureRandom.class, repeatableRandom());
    getServices().put(Time.class, realtime ? new Time.Realtime() : new DevTime());
    EmailDev.install(this);
    Prod.controllers(this);
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

  public static void main(String[] args) {
    Jooby.runApp(args, () -> new Dev(true));
  }
}
