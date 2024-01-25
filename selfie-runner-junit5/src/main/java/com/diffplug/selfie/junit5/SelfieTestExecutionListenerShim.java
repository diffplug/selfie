/*
 * Copyright (C) 2024 DiffPlug
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.diffplug.selfie.junit5;

import org.junit.platform.engine.TestExecutionResult;
import org.junit.platform.launcher.TestExecutionListener;
import org.junit.platform.launcher.TestIdentifier;
import org.junit.platform.launcher.TestPlan;

import java.lang.reflect.InvocationTargetException;

public class SelfieTestExecutionListenerShim implements TestExecutionListener {
    private final TestExecutionListener delegate;

    public SelfieTestExecutionListenerShim() throws ClassNotFoundException, InvocationTargetException, InstantiationException, IllegalAccessException, NoSuchMethodException {
        delegate = (TestExecutionListener) Class.forName("com.diffplug.selfie.junit5.SelfieTestExecutionListener")
                .getDeclaredConstructor().newInstance();
    }

    @Override
    public void executionStarted(TestIdentifier testIdentifier) {
        delegate.executionStarted(testIdentifier);
    }

    @Override
    public void executionSkipped(TestIdentifier testIdentifier, String reason) {
        delegate.executionSkipped(testIdentifier, reason);
    }

    @Override
    public void executionFinished(TestIdentifier testIdentifier, TestExecutionResult testExecutionResult) {
        delegate.executionFinished(testIdentifier, testExecutionResult);
    }

    @Override
    public void testPlanExecutionFinished(TestPlan testPlan) {
        delegate.testPlanExecutionFinished(testPlan);
    }
}
