/*
 * Copyright (C) 2018-2023 DiffPlug, LLC - All Rights Reserved
 * Unauthorized copying of this file via any medium is strictly prohibited.
 * Proprietary and confidential.
 * Please send any inquiries to Ned Twigg <ned.twigg@diffplug.com>
 */
package com.example;

import io.jooby.Jooby;
import io.jooby.MediaType;
import jakarta.inject.Provider;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

public class EmailDev extends Email {
  private final Storage storage;

  private EmailDev(Storage storage) {
    this.storage = storage;
  }

  @Override
  public void doSend() {
    storage.addEmail(this);
  }

  public static EmailDev waitForIncoming(Jooby app) {
    return app.require(Storage.class).waitForIncoming();
  }

  static void install(Jooby app) {
    var storage = new Storage();
    app.getServices().put(Storage.class, storage);
    app.getServices().put(Email.class, (Provider<Email>) () -> new EmailDev(storage));
    app.get(
        "/email",
        ctx -> {
          ctx.setResponseType(MediaType.html);
          var builder = new StringBuilder();
          builder.append("<h2>Messages</h2>");
          builder.append("<ul>");
          var messages = ctx.require(Storage.class).allEmails();
          if (messages.isEmpty()) {
            builder.append("<li>(none)</li>");
          }
          for (int i = 0; i < messages.size(); ++i) {
            int oneIndexed = i + 1;
            builder.append("<li><a href=\"/email/message/" + oneIndexed + "\">");
            builder.append(oneIndexed + ": ");
            var message = messages.get(i);
            builder.append(message.to.toString());
            builder.append(" ");
            builder.append(message.subject);
            builder.append("</a></li>");
          }
          builder.append("</ul>");
          return builder.toString();
        });
    app.get(
        "/email/message/{idx}",
        ctx -> {
          var idx = ctx.path("idx").intValue() - 1;
          var messages = ctx.require(Storage.class).allEmails();
          if (idx >= 0 && idx < messages.size()) {
            ctx.setResponseType(MediaType.html);
            return messages.get(idx).htmlMsg;
          } else {
            return "No such message";
          }
        });
  }

  private static class Storage {
    ArrayList<EmailDev> emails = new ArrayList<>();
    private int numRead = 0;
    private ReentrantLock lock = new ReentrantLock();
    private Condition condition = lock.newCondition();

    List<EmailDev> allEmails() {
      lock.lock();
      try {
        return new ArrayList<>(emails);
      } finally {
        lock.unlock();
      }
    }

    void addEmail(EmailDev email) {
      lock.lock();
      try {
        emails.add(email);
        condition.signalAll();
      } finally {
        lock.unlock();
      }
    }

    EmailDev waitForIncoming() {
      lock.lock();
      try {
        long start = System.currentTimeMillis();
        while (emails.size() < numRead + 1) {
          long TIMEOUT_MS = 1000;
          long toWait = start + TIMEOUT_MS - System.currentTimeMillis();
          if (toWait <= 0) {
            throw new IllegalStateException("Email wasn't sent within " + TIMEOUT_MS + "ms");
          }
          condition.await(start + TIMEOUT_MS - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
        }
        var newEmail = emails.get(numRead);
        numRead += 1;
        return newEmail;
      } catch (InterruptedException e) {
        throw new RuntimeException(e);
      } finally {
        lock.unlock();
      }
    }
  }
}
