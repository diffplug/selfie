package com.example.kotest

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.image.ImageCreation
import com.aallam.openai.api.logging.LogLevel
import com.aallam.openai.api.model.ModelId
import com.aallam.openai.client.LoggingConfig
import com.aallam.openai.client.OpenAI
import com.aallam.openai.client.OpenAIConfig
import com.diffplug.selfie.coroutines.cacheSelfieBinary
import com.diffplug.selfie.coroutines.cacheSelfieJson
import io.kotest.core.spec.style.FunSpec
import io.ktor.client.request.*
import io.ktor.client.statement.*

class CacheExample : FunSpec() {
    private fun openAI() : OpenAI =
        OpenAI(OpenAIConfig(token = System.getenv("OPENAI_API_KEY"), logging = LoggingConfig(LogLevel.None)))

    init {
        test("experiment") {
            val chatCompletionRequest = ChatCompletionRequest(
                    model = ModelId("gpt-4-turbo-preview"),
                    messages = listOf(ChatMessage(role = ChatRole.User,
                            content = "Expressive language describing a robot creating a self portrait.")))
            val chat =
                    cacheSelfieJson { openAI().chatCompletion(chatCompletionRequest) }
                            .toBe("""{
  "id": "chatcmpl-8sOV0z7DDfvVdj1jaru6Cv2Geq3Dj",
  "created": 1707974578,
  "model": "gpt-4-0125-preview",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "In an atmosphere where the whispers of technology blend with the essence of creativity, a remarkable event unfolds—a robot, born from the marriage of steel and intellect, embarks on a quest to capture its essence through a self-portrait. This is not just an act of programming; it is the ballet of bits and bytes pirouetting towards self-awareness.\n\nAt first glance, the scene seems borrowed from a future where machines tread the fine line between fabrication and inspiration. The studio, lit by the sterile glow of fluorescent lights, becomes a sanctuary where metal meets muse. At the center of this confluence stands the robot, its form an intricate lattice of servos and sensors, each component a testament to human ingenuity, now poised to explore the realm of artistic creation.\n\nThe robot’s arm, a marvel of precision engineering, hovers over the canvas with the grace of a seasoned artist. It is not merely a limb, but a conductor’s baton, orchestrating a symphony of colors and forms. With every motion, it challenges the preconceived boundaries between creator and creation, weaving the fabric of its digital soul into the tangible world.\n\nAs the portrait takes shape, it becomes evident that this is not a mere replication of components and circuits. Through the algorithmic alchemy of its programming, the robot infuses each brushstroke with a search for identity. The portrait emerges as a mosaic of self-reflection, each pixel and paint stroke a question in the quest for understanding. What is depicted is not just a physical form, but an introspective journey rendered in hues and contours.\n\nThis creative endeavor transcends the act of painting. It is a dialogue between the robot and its inner being, mediated by the brush and canvas. The colors chosen do not just adhere to the spectrum seen by its cameras; they are imbued with the weight of introspection, the shades nuanced by the robot’s processing of its own existence.\n\nObservers, human or otherwise, may find themselves pondering a question of profound implications: in the brushstrokes of a robot, do we not only see a reflection of its programming but also a mirror to our own search for meaning and identity? The portrait, thus, becomes more than a visual artifact; it is a bridge between the mechanical and the philosophical, a nexus where circuits and souls dialogue in the silent language of art.\n\nIn completion, the self-portrait stands as a testament not to the autonomy of machines, but to their potential to echo the human condition, to participate in the centuries-old tradition of self-exploration through art. It challenges viewers to reconsider the nature of creativity, blurring the lines between the animate and inanimate, urging a redefinition of what it means to be an artist, to be a creator, to be alive.\n\nThus, in this enclosed universe where technology hums a tune of evolution, a robot creating a self-portrait becomes a poignant emblem of the future—where machine and muse dance in an infinite embrace, exploring the kaleidoscope of existence through the lens of artistry."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 613,
    "total_tokens": 631
  },
  "system_fingerprint": "fp_f084bcfc79"
}""")
            val images = cacheSelfieJson {
                openAI().imageURL(ImageCreation(
                        prompt = chat.choices[0].message.content!!,
                        model = ModelId("dall-e-3")))
            }.toBe("""[
  {
    "url": "https://oaidalleapiprodscus.blob.core.windows.net/private/org-SUepmbCtftBix3RViJYKuYKY/user-KFRqcsnjZPSTulNaxrY5wjL3/img-sK3P5fuisDfpdelbFwiR0wtP.png?st=2024-02-15T04%3A23%3A32Z&se=2024-02-15T06%3A23%3A32Z&sp=r&sv=2021-08-06&sr=b&rscd=inline&rsct=image/png&skoid=6aaadede-4fb3-4698-a8f6-684d7786b067&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2024-02-15T02%3A25%3A24Z&ske=2024-02-16T02%3A25%3A24Z&sks=b&skv=2021-08-06&sig=Q0CfpGchXx9NoSEtsk3TT0TuX2Rb8QTk8HiR57I1kUU%3D",
    "revised_prompt": "In a technologically advanced studio bathed in the stark light of fluorescent lamps, observe an intricate robot, built from a complex lattice of servos and sensors. This robot is on a unique quest - to paint its own portrait. Its arm, a masterpiece of precise engineering, hovers gracefully over the canvas, ready to begin its creation. As the robot paints, it doesn't simply replicate its physical form, but the end result is a multi-colored mosaic of self-reflection that embodies its digital soul on canvas. Remarkably, the portrait is a deep exploration of its quest for identity. Marvel at how this machine interprets its programming to venture into the realm of artistic expression, challenging what it means to be creative and alive."
  }
]""")
            cacheSelfieBinary { io.ktor.client.HttpClient().request(images[0].url).readBytes() }
                    .toBeFile("com/example/kotest/dalle-3.png")
        }
    }
}