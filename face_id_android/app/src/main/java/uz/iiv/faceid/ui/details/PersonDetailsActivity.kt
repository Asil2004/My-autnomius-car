package uz.iiv.faceid.ui.details

import android.graphics.BitmapFactory
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uz.iiv.faceid.database.AppDatabase
import uz.iiv.faceid.database.FaceEntity
import uz.iiv.faceid.databinding.ActivityPersonDetailsBinding
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PersonDetailsActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPersonDetailsBinding
    private var personId: Long = -1
    private var currentPerson: FaceEntity? = null
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPersonDetailsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        personId = intent.getLongExtra("PERSON_ID", -1)

        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.btnDeletePerson.setOnClickListener {
            confirmDelete()
        }

        loadPersonDetails()
    }

    private fun loadPersonDetails() {
        if (personId == -1L) {
            finish()
            return
        }

        lifecycleScope.launch(Dispatchers.IO) {
            val person = AppDatabase.getInstance(applicationContext).faceDao().getById(personId)
            currentPerson = person

            withContext(Dispatchers.Main) {
                if (person == null) {
                    finish()
                    return@withContext
                }

                binding.tvDetailName.text = person.fullName
                binding.tvDetailRole.text = person.role
                binding.tvDetailDate.text = "Ro'yxatga olindi: ${dateFormat.format(Date(person.createdAt))}"

                if (!person.imagePath.isNullOrEmpty()) {
                    val file = File(person.imagePath)
                    if (file.exists()) {
                        val bitmap = BitmapFactory.decodeFile(file.absolutePath)
                        if (bitmap != null) {
                            binding.ivDetailPhoto.setImageBitmap(bitmap)
                        }
                    }
                }

                // Render vector stats
                val emb = person.embedding
                val previewVector = emb.take(8).joinToString(separator = ", ") { String.format("%.4f", it) }
                val minVal = emb.minOrNull() ?: 0.0f
                val maxVal = emb.maxOrNull() ?: 0.0f
                val meanVal = emb.average().toFloat()

                val info = """
                    Arxitektura: MobileFaceNet (Deep Convolutional)
                    Vektor o'lchami: ${emb.size} ta Float32 qiymat
                    Normallashtirish: L2 Unit Sphere (|v| = 1.0)
                    Minimal qiymat: ${String.format("%.4f", minVal)}
                    Maksimal qiymat: ${String.format("%.4f", maxVal)}
                    O'rtacha qiymat: ${String.format("%.4f", meanVal)}
                    
                    Vektor kesimi (Dastlabki 8 komponent):
                    [$previewVector, ...]
                    
                    Taqqoslash algoritmi: Normalized Cosine Similarity Dot Product
                    Baza xavfsizligi: AES-shifrlashga mos mahalliy Room SQLite
                """.trimIndent()

                binding.tvVectorInfo.text = info
            }
        }
    }

    private fun confirmDelete() {
        val person = currentPerson ?: return
        AlertDialog.Builder(this)
            .setTitle("O'chirishni tasdiqlang")
            .setMessage("${person.fullName} ma'lumotlar bazasidan butunlay o'chirilsinmi?")
            .setPositiveButton("Ha, O'chirish") { _, _ ->
                deletePerson(person)
            }
            .setNegativeButton("Bekor qilish", null)
            .show()
    }

    private fun deletePerson(person: FaceEntity) {
        lifecycleScope.launch(Dispatchers.IO) {
            AppDatabase.getInstance(applicationContext).faceDao().delete(person)
            if (!person.imagePath.isNullOrEmpty()) {
                val f = File(person.imagePath)
                if (f.exists()) f.delete()
            }
            withContext(Dispatchers.Main) {
                Toast.makeText(this@PersonDetailsActivity, "${person.fullName} o'chirildi", Toast.LENGTH_SHORT).show()
                finish()
            }
        }
    }
}
