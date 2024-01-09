package com.example;

import io.jooby.Jooby;
import io.jooby.MediaType;
import io.jooby.SneakyThrows;
import jakarta.inject.Provider;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;

public class Prod extends Jooby {
  {
    getServices().put(SecureRandom.class, secureRandom());
    getServices().put(Time.class, new Time.Realtime());
    getServices().put(Email.class, (Provider<Email>) () -> new Email.Production());
    Prod.controllers(this);
  }

  static void controllers(Jooby jooby) {
    jooby.before(
        ctx -> {
          ctx.setDefaultResponseType(MediaType.html);
        });
    jooby.install(new Account());
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
